import { useState, useEffect } from 'react';
import { 
  MessageSquare, Code, Cpu, Plus, Play, 
  Settings, Terminal, Folder, FileText, RefreshCw, FolderOpen, Search, X, Check, ArrowUp
} from 'lucide-react';

interface Message {
  id: number;
  sender: 'user' | 'agent';
  text: string;
}

interface Session {
  id: string;
  title: string;
  model: string;
  type: 'chat' | 'workspace';
}

interface FileNode {
  name: string;
  path: string;
  full_path: string;
  type: 'file' | 'directory';
}

interface BrowseFolder {
  name: string;
  full_path: string;
}

export default function App() {
  const [viewMode, setViewMode] = useState<'chat' | 'code'>('chat');
  const [rightTab, setRightTab] = useState<'chat' | 'logs'>('chat');
  
  // 공통 모델 상태
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('qwen2.5-coder:14b');
  
  // 1. [Chat 모드 전용 상태]
  const [chatSessions, setChatSessions] = useState<Session[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState<string>('');

  // 2. [Workspace 모드 전용 상태]
  const [wsSessions, setWsSessions] = useState<Session[]>([]);
  const [activeWsSessionId, setActiveWsSessionId] = useState<string>('');
  const [wsMessages, setWsMessages] = useState<Message[]>([]);
  const [wsInput, setWsInput] = useState<string>('');

  // 스트리밍 및 CLI 로그 상태
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [cliLogs, setCliLogs] = useState<string[]>([]);

  // Workspace 및 디렉터리 상태
  const [workspaceDir, setWorkspaceDir] = useState<string>('./workspace');
  const [workspaceFiles, setWorkspaceFiles] = useState<FileNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string>('');
  const [isLoadingFile, setIsLoadingFile] = useState<boolean>(false);

  // 디렉터리 선택 모달 상태
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [browseCurrentPath, setBrowseCurrentPath] = useState<string>('');
  const [browseParentPath, setBrowseParentPath] = useState<string | null>(null);
  const [browseFolders, setBrowseFolders] = useState<BrowseFolder[]>([]);

  // 초기화 로드
  useEffect(() => {
    fetchModels();
    fetchChatSessions();
    fetchWsSessions();
    fetchWorkspaceFiles();
  }, []);

  // Chat 세션 변경 감지
  useEffect(() => {
    if (activeChatSessionId) {
      fetchSessionMessages(activeChatSessionId, 'chat');
    } else {
      setChatMessages([]);
    }
  }, [activeChatSessionId]);

  // Workspace 세션 변경 감지
  useEffect(() => {
    if (activeWsSessionId) {
      fetchSessionMessages(activeWsSessionId, 'workspace');
    } else {
      setWsMessages([]);
    }
  }, [activeWsSessionId]);

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        setModels(data.models);
        setSelectedModel(data.models[0]);
      }
    } catch (e) {
      console.error('Failed to fetch models:', e);
    }
  };

  const fetchChatSessions = async () => {
    try {
      const res = await fetch('/api/sessions?type=chat');
      const data: Session[] = await res.json();
      setChatSessions(data);
      if (data.length > 0 && !activeChatSessionId) {
        setActiveChatSessionId(data[0].id);
      }
    } catch (e) {
      console.error('Failed to fetch chat sessions:', e);
    }
  };

  const fetchWsSessions = async () => {
    try {
      const res = await fetch('/api/sessions?type=workspace');
      const data: Session[] = await res.json();
      setWsSessions(data);
      if (data.length > 0 && !activeWsSessionId) {
        setActiveWsSessionId(data[0].id);
      }
    } catch (e) {
      console.error('Failed to fetch workspace sessions:', e);
    }
  };

  const fetchSessionMessages = async (sessionId: string, mode: 'chat' | 'workspace') => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`);
      const data = await res.json();
      const loadedMessages: Message[] = data.map((msg: any) => ({
        id: msg.id,
        sender: msg.role === 'user' ? 'user' : 'agent',
        text: msg.content
      }));
      if (mode === 'chat') {
        setChatMessages(loadedMessages);
      } else {
        setWsMessages(loadedMessages);
      }
    } catch (e) {
      console.error('Failed to fetch session messages:', e);
    }
  };

  const handleCreateSession = async (mode: 'chat' | 'workspace') => {
    try {
      const titlePrefix = mode === 'chat' ? 'Chat Session' : 'WS Task';
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${titlePrefix} (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
          model: selectedModel,
          type: mode
        })
      });
      const newSession: Session = await res.json();
      
      if (mode === 'chat') {
        setChatSessions((prev) => [newSession, ...prev]);
        setActiveChatSessionId(newSession.id);
        setChatMessages([]);
      } else {
        setWsSessions((prev) => [newSession, ...prev]);
        setActiveWsSessionId(newSession.id);
        setWsMessages([]);
      }
    } catch (e) {
      console.error('Failed to create session:', e);
    }
  };

  const fetchWorkspaceFiles = async () => {
    try {
      const res = await fetch('/api/workspace/files');
      const data = await res.json();
      if (data.files) setWorkspaceFiles(data.files);
      if (data.directory) setWorkspaceDir(data.directory);
    } catch (e) {
      console.error('Failed to fetch workspace files:', e);
    }
  };

  const fetchBrowsePath = async (targetPath?: string) => {
    try {
      const url = targetPath 
        ? `/api/workspace/browse?path=${encodeURIComponent(targetPath)}`
        : '/api/workspace/browse';
      const res = await fetch(url);
      const data = await res.json();
      setBrowseCurrentPath(data.current_path);
      setBrowseParentPath(data.parent_path);
      setBrowseFolders(data.folders || []);
    } catch (e) {
      console.error('Failed to browse system directory:', e);
    }
  };

  const handleOpenFolderModal = () => {
    setIsModalOpen(true);
    fetchBrowsePath(workspaceDir);
  };

  const handleConfirmSelectDirectory = async () => {
    try {
      const res = await fetch('/api/workspace/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_path: browseCurrentPath })
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspaceDir(data.directory);
        setWorkspaceFiles(data.files);
        setSelectedFilePath(null);
        setSelectedFileContent('');
        setIsModalOpen(false);
      } else {
        const err = await res.json();
        alert(`디렉터리 로드 실패: ${err.detail}`);
      }
    } catch (e) {
      console.error('Failed to load directory:', e);
    }
  };

  const handleSelectFile = async (filePath: string) => {
    setSelectedFilePath(filePath);
    setIsLoadingFile(true);
    try {
      const res = await fetch(`/api/workspace/file-content?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        const errorData = await res.json();
        setSelectedFileContent(`// [오류] ${errorData.detail || '파일을 불러올 수 없습니다.'}`);
        return;
      }
      const data = await res.json();
      setSelectedFileContent(data.content || '');
    } catch (e) {
      setSelectedFileContent(`// [오류] 파일 읽기 에러: ${String(e)}`);
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleSendMessage = () => {
    const isChat = viewMode === 'chat';
    const currentInput = isChat ? chatInput : wsInput;
    const currentSessionId = isChat ? activeChatSessionId : activeWsSessionId;

    if (!currentInput.trim() || isStreaming || !currentSessionId) return;

    const userMsg: Message = { id: Date.now(), sender: 'user', text: currentInput };
    const botMsgId = Date.now() + 1;

    if (isChat) {
      setChatMessages((prev) => [...prev, userMsg, { id: botMsgId, sender: 'agent', text: '' }]);
      setChatInput('');
    } else {
      setWsMessages((prev) => [...prev, userMsg, { id: botMsgId, sender: 'agent', text: '' }]);
      setWsInput('');
    }

    setIsStreaming(true);

    const updateBotMessage = (token: string) => {
      if (isChat) {
        setChatMessages((prev) =>
          prev.map((msg) => (msg.id === botMsgId ? { ...msg, text: msg.text + token } : msg))
        );
      } else {
        setWsMessages((prev) =>
          prev.map((msg) => (msg.id === botMsgId ? { ...msg, text: msg.text + token } : msg))
        );
      }
    };

    const eventSource = new EventSource(
      `/api/agent/stream?prompt=${encodeURIComponent(currentInput)}&model=${encodeURIComponent(selectedModel)}&session_id=${currentSessionId}`
    );

    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === 'token') {
          updateBotMessage(payload.content);
        } else if (payload.type === 'tool_log') {
          setCliLogs((prev) => [...prev, payload.content]);
        } else if (payload.type === 'workspace_updated') {
          fetchWorkspaceFiles();
          if (selectedFilePath) {
            handleSelectFile(selectedFilePath);
          }
        }
      } catch (err) {
        console.error('SSE Parse Error:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsStreaming(false);
    };
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-900 text-slate-100 overflow-hidden font-sans">
      
      {/* 1. TOP HEADER */}
      <header className="h-14 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Cpu className="text-cyan-400 w-6 h-6" />
            <span className="font-bold text-lg tracking-wide">NLABS Agent</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => setViewMode('chat')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition ${viewMode === 'chat' ? 'bg-slate-800 text-cyan-400 border border-slate-700' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <MessageSquare className="w-3.5 h-3.5" /> Chat
            </button>
            <button 
              onClick={() => setViewMode('code')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition ${viewMode === 'code' ? 'bg-slate-800 text-cyan-400 border border-slate-700' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Code className="w-3.5 h-3.5" /> Workspace
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <select 
            value={selectedModel} 
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-slate-900 text-cyan-400 border border-slate-700 rounded-lg px-3 py-1.5 focus:outline-none"
          >
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className="w-7 h-7 rounded-full bg-cyan-600 flex items-center justify-center font-bold text-xs">DEV</div>
            <Settings className="w-4 h-4 text-slate-400 hover:text-slate-200 cursor-pointer transition" />
          </div>
        </div>
      </header>

      {/* 2. MAIN BODY AREA */}
      <div className="flex-1 flex overflow-hidden">

        {/* ==================== MODE 1: CHAT UI ==================== */}
        {viewMode === 'chat' && (
          <>
            {/* CHAT 좌측 사이드바: 챗 전용 세션 관리 */}
            <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0">
              <div className="p-3">
                <button 
                  onClick={() => handleCreateSession('chat')}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 px-4 rounded-lg border border-slate-700 transition text-sm font-medium"
                >
                  <Plus className="w-4 h-4" /> 새 대화 시작
                </button>

                <div className="mt-4 px-1 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  CHAT SESSIONS
                </div>
                <nav className="space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {chatSessions.map((sess) => (
                    <button 
                      key={sess.id}
                      onClick={() => setActiveChatSessionId(sess.id)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md truncate flex items-center justify-between transition ${
                        activeChatSessionId === sess.id ? 'bg-cyan-950/50 text-cyan-400 border border-cyan-800/50' : 'text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <MessageSquare className="w-4 h-4 shrink-0" />
                        <span className="truncate">{sess.title}</span>
                      </div>
                    </button>
                  ))}
                </nav>
              </div>

              <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
                Active Chat ID: <br/>
                <span className="text-slate-400 font-mono">{activeChatSessionId || 'None'}</span>
              </div>
            </aside>

            {/* CHAT 대화창 */}
            <main className="flex-1 flex flex-col bg-slate-900 justify-between p-6 overflow-hidden">
              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500">
                    <Cpu className="w-12 h-12 mb-3 text-slate-700" />
                    <p className="text-sm">에이전트에게 질의나 대화를 시작하세요.</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-2xl px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.sender === 'user' 
                          ? 'bg-cyan-600 text-white rounded-br-none' 
                          : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-none'
                      }`}>
                        {msg.text || (isStreaming && '에이전트 답변 생성 중...')}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 relative">
                <textarea 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                  placeholder="대화 내용을 입력하세요..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 pr-12 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 resize-none h-24"
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={isStreaming || !activeChatSessionId}
                  className="absolute right-3 bottom-4 p-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded-lg transition"
                >
                  <Play className="w-4 h-4 fill-current" />
                </button>
              </div>
            </main>
          </>
        )}

        {/* ==================== MODE 2: WORKSPACE UI ==================== */}
        {viewMode === 'code' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* 작업 디렉터리 헤더 */}
            <div className="bg-slate-950 border-b border-slate-800 p-3 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <FolderOpen className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-xs text-slate-400 shrink-0 font-medium">현재 작업 디렉터리:</span>
                <span className="text-xs text-emerald-400 font-mono truncate bg-slate-900 px-3 py-1 rounded border border-slate-800 flex-1">
                  {workspaceDir}
                </span>
              </div>

              <button 
                onClick={handleOpenFolderModal}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium transition shrink-0 shadow-sm"
              >
                <Search className="w-3.5 h-3.5" /> 디렉터리 변경
              </button>
            </div>

            {/* WORKSPACE 레이아웃 */}
            <div className="flex-1 flex overflow-hidden">
              
              {/* (좌) File Explorer */}
              <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0">
                <div className="p-3 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">File Explorer</span>
                  <button 
                    onClick={fetchWorkspaceFiles} 
                    title="새로고침"
                    className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                  {workspaceFiles.length === 0 ? (
                    <div className="text-xs text-slate-500 p-4 text-center">
                      폴더가 비어 있습니다.
                    </div>
                  ) : (
                    workspaceFiles.map((node) => {
                      if (node.type === 'directory') {
                        return (
                          <div
                            key={node.full_path}
                            className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-300 rounded"
                          >
                            <Folder className="w-4 h-4 text-cyan-500 shrink-0" />
                            <span className="truncate">{node.name}</span>
                          </div>
                        );
                      }

                      const isSelected = selectedFilePath === node.path;
                      return (
                        <div
                          key={node.full_path}
                          onClick={() => handleSelectFile(node.path)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded cursor-pointer transition ${
                            isSelected ? 'bg-cyan-950/60 text-cyan-400 font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{node.name}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>

              {/* (중) Code Viewer */}
              <main className="flex-1 flex flex-col min-w-0 bg-slate-900 border-r border-slate-800">
                <div className="h-10 bg-slate-950 border-b border-slate-800 flex items-center px-4 justify-between shrink-0">
                  <span className="text-xs text-slate-300 font-mono">
                    {selectedFilePath ? `${workspaceDir}/${selectedFilePath}` : '선택된 파일 없음'}
                  </span>
                </div>

                <div className="flex-1 overflow-auto p-4 bg-slate-950/50">
                  {isLoadingFile ? (
                    <div className="text-xs text-slate-500 font-mono">파일 읽는 중...</div>
                  ) : selectedFilePath ? (
                    <pre className="font-mono text-xs text-emerald-400 whitespace-pre-wrap leading-relaxed">
                      {selectedFileContent}
                    </pre>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-xs text-slate-500 gap-2">
                      <FileText className="w-10 h-10 text-slate-700" />
                      <span>좌측 파일 목록에서 소스코드를 선택하세요.</span>
                    </div>
                  )}
                </div>
              </main>

              {/* (우) 독립된 워크스페이스 세션 & 작업 지시/로그 패널 */}
              <aside className="w-96 bg-slate-950 flex flex-col shrink-0 border-l border-slate-800">
                
                {/* 우측 상단: 워크스페이스 전용 세션 드롭다운 & 새 작업 생성 */}
                <div className="p-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2">
                  <select
                    value={activeWsSessionId}
                    onChange={(e) => setActiveWsSessionId(e.target.value)}
                    className="flex-1 bg-slate-950 text-cyan-400 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none truncate"
                  >
                    {wsSessions.length === 0 ? (
                      <option value="">(세션 없음)</option>
                    ) : (
                      wsSessions.map((s) => (
                        <option key={s.id} value={s.id}>{s.title}</option>
                      ))
                    )}
                  </select>
                  <button
                    onClick={() => handleCreateSession('workspace')}
                    title="새 워크스페이스 작업 세션"
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> 새 작업
                  </button>
                </div>

                {/* 탭 헤더 */}
                <div className="flex border-b border-slate-800 bg-slate-900">
                  <button 
                    onClick={() => setRightTab('chat')}
                    className={`flex-1 py-2 text-xs font-semibold border-b-2 flex items-center justify-center gap-1.5 transition ${rightTab === 'chat' ? 'border-cyan-500 text-cyan-400 bg-slate-950/40' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> 작업 지시
                  </button>
                  <button 
                    onClick={() => setRightTab('logs')}
                    className={`flex-1 py-2 text-xs font-semibold border-b-2 flex items-center justify-center gap-1.5 transition ${rightTab === 'logs' ? 'border-cyan-500 text-cyan-400 bg-slate-950/40' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                  >
                    <Terminal className="w-3.5 h-3.5" /> CLI Logs ({cliLogs.length})
                  </button>
                </div>

                {/* TAB 1: 워크스페이스 작업 지시 및 대화 */}
                {rightTab === 'chat' && (
                  <div className="flex-1 flex flex-col justify-between p-3 overflow-hidden">
                    <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                      {wsMessages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center px-4">
                          <Cpu className="w-8 h-8 mb-2 text-slate-700" />
                          <p className="text-xs">코드 수정이나 에이전트 파일 작업 지시를 입력하세요.</p>
                        </div>
                      ) : (
                        wsMessages.map((msg) => (
                          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[88%] px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                              msg.sender === 'user' 
                                ? 'bg-cyan-600 text-white rounded-br-none' 
                                : 'bg-slate-900 text-slate-200 border border-slate-800 rounded-bl-none'
                            }`}>
                              {msg.text || (isStreaming && '작업 실행 중...')}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="mt-3 relative shrink-0">
                      <textarea 
                        value={wsInput}
                        onChange={(e) => setWsInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                        placeholder="코드 수정 및 파일 작업 지시..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 pr-10 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 resize-none h-20"
                      />
                      <button 
                        onClick={handleSendMessage}
                        disabled={isStreaming || !activeWsSessionId}
                        className="absolute right-2 bottom-3 p-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white rounded-md transition"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 2: CLI Logs */}
                {rightTab === 'logs' && (
                  <div className="flex-1 p-3 overflow-y-auto">
                    <div className="space-y-2 font-mono text-[11px]">
                      <div className="text-slate-400 font-sans text-xs mb-2 flex items-center gap-1">
                        <Terminal className="w-3.5 h-3.5 text-cyan-400" /> Tool Execution Trace
                      </div>
                      {cliLogs.length === 0 ? (
                        <div className="text-slate-600 text-xs p-2">수행된 도구 실행 기록이 없습니다.</div>
                      ) : (
                        cliLogs.map((log, index) => (
                          <div key={index} className="text-emerald-400 break-all bg-slate-900 p-2 rounded border border-slate-800/80">
                            {log}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </aside>

            </div>

          </div>
        )}

      </div>

      {/* 3. DIRECTORY CHOOSER MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl">
            
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100">작업 디렉터리 선택</h3>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-950/60 border-b border-slate-800/60 flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium shrink-0">경로:</span>
              <span className="text-xs text-emerald-400 font-mono truncate flex-1 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                {browseCurrentPath}
              </span>
              {browseParentPath && (
                <button
                  onClick={() => fetchBrowsePath(browseParentPath)}
                  title="상위 폴더로 이동"
                  className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition shrink-0"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="p-3 max-h-64 overflow-y-auto space-y-1">
              {browseFolders.length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-6">
                  하위 폴더가 없습니다.
                </div>
              ) : (
                browseFolders.map((folder) => (
                  <div
                    key={folder.full_path}
                    onClick={() => fetchBrowsePath(folder.full_path)}
                    className="flex items-center justify-between p-2 rounded text-xs text-slate-300 hover:bg-slate-800 hover:text-cyan-400 cursor-pointer transition"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder className="w-4 h-4 text-cyan-500 shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                원하는 폴더로 이동한 후 아래 버튼을 누르세요.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 rounded transition"
                >
                  취소
                </button>
                <button
                  onClick={handleConfirmSelectDirectory}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg transition"
                >
                  <Check className="w-3.5 h-3.5" /> 이 디렉터리로 지정 및 로드
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}