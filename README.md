# OpenLocker
로컬 LLM(Ollama)으로 코딩을 돕는 웹 에이전트. FastAPI + React, 혼자 만든 앱이다.
## 홈랩 쿠버네티스 배포
- 집 서버 1대(k3s)에 배포: 앱 Deployment + PostgreSQL StatefulSet, Ingress(traefik)
- GitHub Actions: 빌드 → 컨테이너를 띄워 /healthz·/readyz 검사 → GHCR에 sha-커밋해시 태그로 push
- CI가 k8s/overlays/homelab 의 이미지 태그를 커밋 → Argo CD가 클러스터에 반영(GitOps)
## 폴더
- backend/, frontend/ : 앱
- k8s/base, k8s/overlays/homelab : Kustomize
- k8s/argocd : Argo CD Application
- .github/workflows/ci.yml : CI
## 주의
- 로그인 기능이 없고 서버 파일을 쓰는 API가 있다. 인터넷에 공개하지 말고 집 LAN·VPN 안에서만 쓴다.
## 기록
- velog 시리즈: https://velog.io/@ssler1/series
##