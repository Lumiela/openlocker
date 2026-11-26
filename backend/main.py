import os
import difflib
import json
import asyncio
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

from sqlmodel import SQLModel, Field, Session, create_engine, select

# ----------------------------------------------------
# 0. Database Models & SQLite Setup
# ----------------------------------------------------
DATA_DIR = Path("./data").resolve()
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "nlabs_agent.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

class ChatSession(SQLModel, table=True):
    __table_args__ = {"extend_existing": True}

    id: str = Field(primary_key=True)
    title: str
    model: str
    type: str = Field(default="chat")  # "chat" 또는 "workspace"
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())

class ChatMessage(SQLModel, table=True):
    __table_args__ = {"extend_existing": True}

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    role: str  # "user" 또는 "assistant"
    content: str
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())

engine = create_engine(
    DATABASE_URL, 
    connect_args={"check_same_thread": False},
    execution_options={"isolation_level": "AUTOCOMMIT"}
)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
        # 기존 DB 호환용 컬럼 추가 (type 컬럼 부재 시 스키마 마이그레이션)
        try:
            conn.exec_driver_sql("ALTER TABLE chatsession ADD COLUMN type VARCHAR DEFAULT 'chat';")
        except Exception:
            pass  # 이미 존재하면 무시

def get_db():
    with Session(engine) as session:
        yield session

# ----------------------------------------------------
# FastAPI Lifespan
# ----------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    yield

app = FastAPI(
    title="NLABS Local Agent API", 
    version="1.1.1",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

# 동적 작업 디렉터리 상태 관리
CURRENT_WORKSPACE_DIR = Path("./workspace").resolve()
CURRENT_WORKSPACE_DIR.mkdir(exist_ok=True)

# ----------------------------------------------------
# 1. Schemas & Data Models
# ----------------------------------------------------
class CreateSessionRequest(BaseModel):
    title: str
    model: str
    type: Optional[str] = "chat"

class LoadWorkspaceRequest(BaseModel):
    target_path: str

# ----------------------------------------------------
# 2. Ollama & Session APIs
# ----------------------------------------------------
@app.get("/api/models")
async def get_installed_models():
    """로컬 Ollama 모델 목록 조회"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            res.raise_for_status()
            data = res.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"models": models}
    except Exception as e:
        return {"models": ["qwen2.5-coder:14b"], "error": str(e)}

@app.get("/api/sessions")
async def list_sessions(type: Optional[str] = Query(None), db: Session = Depends(get_db)):
    """세션 목록 조회 (type 필터링 지원)"""
    statement = select(ChatSession)
    if type:
        statement = statement.where(ChatSession.type == type)
    statement = statement.order_by(ChatSession.created_at.desc())
    sessions = db.exec(statement).all()
    return sessions

@app.post("/api/sessions")
async def create_session(req: CreateSessionRequest, db: Session = Depends(get_db)):
    """신규 세션 생성"""
    session_id = f"session_{int(datetime.now().timestamp() * 1000)}"
    new_session = ChatSession(
        id=session_id,
        title=req.title,
        model=req.model,
        type=req.type or "chat",
        created_at=datetime.now().isoformat()
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session

@app.get("/api/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, db: Session = Depends(get_db)):
    """세션 내 메시지 대화 내역 조회"""
    messages = db.exec(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.id.asc())
    ).all()
    return messages

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, db: Session = Depends(get_db)):
    """세션 및 메시지 삭제"""
    session_obj = db.get(ChatSession, session_id)
    if not session_obj:
        raise HTTPException(status_code=404, detail="Session not found")
    
    messages = db.exec(select(ChatMessage).where(ChatMessage.session_id == session_id)).all()
    for msg in messages:
        db.delete(msg)
        
    db.delete(session_obj)
    db.commit()
    return {"status": "deleted"}

# ----------------------------------------------------
# 3. Dynamic Workspace Directory Chooser & File APIs
# ----------------------------------------------------
def safe_path(rel_path: str) -> Path:
    """현재 작업 디렉터리 내부 경로 검증"""
    target = (CURRENT_WORKSPACE_DIR / rel_path).resolve()
    if not str(target).startswith(str(CURRENT_WORKSPACE_DIR)):
        raise ValueError("설정된 작업 디렉터리 바깥 경로에는 접근할 수 없습니다.")
    return target

def get_dir_tree(base_path: Path) -> List[Dict[str, Any]]:
    """지정한 디렉터리 경로의 1단계 하위 폴더 및 파일 목록을 반환"""
    items = []
    if not base_path.exists():
        return items
    try:
        for entry in sorted(base_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith(".") or entry.name == "__pycache__":
                continue

            items.append({
                "name": entry.name,
                "path": entry.name,
                "full_path": str(entry.resolve()),
                "type": "directory" if entry.is_dir() else "file"
            })
    except Exception as e:
        print(f"Error scanning directory {base_path}: {e}")
    return items

@app.get("/api/workspace/browse")
async def browse_system_directory(path: Optional[str] = Query(None)):
    """디렉터리 선택 모달용 시스템 디렉터리 브라우징 API"""
    try:
        target = Path(path).resolve() if path else Path.cwd().resolve()
        if not target.exists() or not target.is_dir():
            target = Path.cwd().resolve()

        subfolders = []
        try:
            for entry in sorted(target.iterdir(), key=lambda e: e.name.lower()):
                if entry.is_dir() and not entry.name.startswith("."):
                    subfolders.append({
                        "name": entry.name,
                        "full_path": str(entry.resolve())
                    })
        except PermissionError:
            pass

        return {
            "current_path": str(target),
            "parent_path": str(target.parent) if target != target.parent else None,
            "folders": subfolders
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/workspace/config")
async def get_workspace_config():
    """현재 설정된 작업 디렉터리 절대 경로 반환"""
    return {
        "directory": str(CURRENT_WORKSPACE_DIR)
    }

@app.post("/api/workspace/load")
async def load_workspace_directory(req: LoadWorkspaceRequest):
    """지정한 경로를 선택하여 작업 디렉터리로 로드"""
    global CURRENT_WORKSPACE_DIR
    try:
        target = Path(req.target_path).resolve()
        if not target.exists():
            raise HTTPException(status_code=404, detail="존재하지 않는 디렉터리입니다.")
        if not target.is_dir():
            raise HTTPException(status_code=400, detail="디렉터리가 아닌 파일 경로입니다.")
            
        CURRENT_WORKSPACE_DIR = target
        return {
            "directory": str(CURRENT_WORKSPACE_DIR),
            "files": get_dir_tree(CURRENT_WORKSPACE_DIR)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"디렉터리 로드 실패: {str(e)}")

@app.get("/api/workspace/files")
async def list_workspace_files():
    """현재 작업 디렉터리의 파일 및 폴더 목록 반환"""
    tree = get_dir_tree(CURRENT_WORKSPACE_DIR)
    return {
        "directory": str(CURRENT_WORKSPACE_DIR),
        "files": tree
    }

@app.get("/api/workspace/file-content")
async def get_file_content(path: str = Query(...)):
    """현재 작업 디렉터리 내부 파일 내용 읽기"""
    try:
        p = safe_path(path)
        if not p.exists() or not p.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        content = p.read_text(encoding="utf-8")
        return {"path": path, "content": content}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="이 파일은 텍스트 형태가 아니어서 열 수 없습니다.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def execute_file_tool(action: str, rel_path: str, content: str = "", search: str = "", replace: str = "") -> str:
    """에이전트 파일 작업 실행 (CRUD + Block Replace Diff)"""
    try:
        p = safe_path(rel_path)
        
        # 1. 파일 생성 / 전체 덮어쓰기
        if action == "write":
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
            return f"[File Created/Updated] {rel_path} (in {CURRENT_WORKSPACE_DIR})"
            
        # 2. 파일 삭제
        elif action == "delete":
            if p.exists():
                p.unlink()
                return f"[File Deleted] {rel_path}"
            return f"[File Not Found] {rel_path}"
            
        # 3. 파일 읽기
        elif action == "read":
            if p.exists():
                return p.read_text(encoding="utf-8")
            return "[File Not Found]"

        # 4. 블록 단주 수정 (SEARCH / REPLACE)
        elif action == "replace":
            if not p.exists():
                return f"[Replace Failed] File not found: {rel_path}"

            original_text = p.read_text(encoding="utf-8")

            if search not in original_text:
                return f"[Replace Failed] Could not find exact search block in {rel_path}"

            # 코드 교체 수행 (1회만 교체)
            updated_text = original_text.replace(search, replace, 1)
            p.write_text(updated_text, encoding="utf-8")

            # 변경된 내역을 Diff 형태로 생성하여 반환
            diff_lines = list(difflib.unified_diff(
                original_text.splitlines(keepends=True),
                updated_text.splitlines(keepends=True),
                fromfile=f"a/{rel_path}",
                tofile=f"b/{rel_path}"
            ))
            diff_text = "".join(diff_lines)

            return f"[File Block Replaced] {rel_path}\n```diff\n{diff_text}```"

    except Exception as e:
        return f"[Tool Error] {str(e)}"
        
    return "[Unknown Action]"

# ----------------------------------------------------
# 4. SSE Real-time Agent Pipeline
# ----------------------------------------------------
@app.get("/api/agent/stream")
async def stream_agent(prompt: str, session_id: str = "default", model: str = "qwen2.5-coder:14b"):
    async def event_generator():
        yield f"data: {json.dumps({'type': 'node_status', 'node': 'Prompt Parser'})}\n\n"
        await asyncio.sleep(0.1)
        
        with Session(engine) as db:
            user_msg = ChatMessage(
                session_id=session_id,
                role="user",
                content=prompt
            )
            db.add(user_msg)
            db.commit()

        yield f"data: {json.dumps({'type': 'node_status', 'node': 'LLM Generation'})}\n\n"
        
        system_instructions = (
            f"You are a local coding agent working inside directory: {CURRENT_WORKSPACE_DIR}\n"
            "When modifying existing files, NEVER rewrite the whole file. Instead, use the 'replace' action with exact SEARCH/REPLACE blocks.\n\n"
            "JSON Formats:\n"
            "1. To modify part of a file:\n"
            "```json\n"
            "{\n"
            '  "action": "replace",\n'
            '  "path": "example.py",\n'
            '  "search": "def old_func():\\n    return False",\n'
            '  "replace": "def old_func():\\n    return True"\n'
            "}\n"
            "```\n"
            "2. To create/overwrite a full file:\n"
            '```json\n{"action": "write", "path": "example.py", "content": "..."}\n```\n'
            "3. To delete a file:\n"
            '```json\n{"action": "delete", "path": "example.py"}\n```\n\n'
        )

        system_prompt = system_instructions + f"User Prompt: {prompt}"

        payload = {
            "model": model,
            "prompt": system_prompt,
            "stream": True
        }

        full_response = ""
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", f"{OLLAMA_BASE_URL}/api/generate", json=payload) as resp:
                    async for line in resp.aiter_lines():
                        if line:
                            chunk = json.loads(line)
                            token = chunk.get("response", "")
                            full_response += token
                            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                            if chunk.get("done", False):
                                break
        except Exception as e:
            err_text = f"\n[Ollama Connection Error] {str(e)}"
            yield f"data: {json.dumps({'type': 'token', 'content': err_text})}\n\n"
            full_response += err_text

        with Session(engine) as db:
            assistant_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=full_response
            )
            db.add(assistant_msg)
            db.commit()

        yield f"data: {json.dumps({'type': 'node_status', 'node': 'Local Code Execution'})}\n\n"
        if "```json" in full_response:
            try:
                json_str = full_response.split("```json")[1].split("```")[0].strip()
                tool_data = json.loads(json_str)
                tool_result = execute_file_tool(
                    action=tool_data.get("action"),
                    rel_path=tool_data.get("path"),
                    content=tool_data.get("content", "")
                )
                yield f"data: {json.dumps({'type': 'tool_log', 'content': tool_result})}\n\n"
                yield f"data: {json.dumps({'type': 'workspace_updated'})}\n\n"
            except Exception as parse_err:
                err_parse_text = f"Parse Error: {str(parse_err)}"
                yield f"data: {json.dumps({'type': 'tool_log', 'content': err_parse_text})}\n\n"

        yield f"data: {json.dumps({'type': 'node_status', 'node': 'Idle'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# ----------------------------------------------------
# 5. Frontend Static Files & SPA Fallback Routing
# ----------------------------------------------------
DIST_DIR = Path(__file__).parent / "dist"

if DIST_DIR.exists():
    # 1) JS/CSS 등 Vite 빌드 결과물의 자산 디렉터리 마운트
    if (DIST_DIR / "assets").exists():
        app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

    # 2) SPA (Single Page Application) 라우팅 핸들러
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # API 요청 경로로 시작하는 경우 404로 통과 (백엔드 라우트 우선 처리 보장)
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")

        # 루트 경로 접속 시 바로 index.html 반환
        if not full_path:
            return FileResponse(DIST_DIR / "index.html")

        requested_file = DIST_DIR / full_path

        # favicon.ico, favicon.svg 등 dist 내부의 개별 정적 파일이 실존하면 그대로 서빙
        if requested_file.exists() and requested_file.is_file():
            return FileResponse(requested_file)

        # 그 외 클라이언트 사이드 라우팅 경로일 경우 React/Vite 엔트리 포인트 반환
        return FileResponse(DIST_DIR / "index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)