"""
Delivery Node — clones the final main branch, builds a Docker image,
runs the container, and reports a demo URL via SSE.
Runs after orchestrator_node once all epics are merged.
"""
import asyncio
import os
import re
import tempfile
from typing import Optional

from app.api.sse import emit
from app.graph.services.state_manager import StateManager
from app.graph.state import GraphState


async def _run(cmd: str, cwd: str) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_shell(
        cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


_DB_PORTS = {5432, 3306, 5433, 6379, 27017, 6380, 9200, 5672, 15672}
_FRONTEND_NAMES = {"frontend", "web", "app", "ui", "client", "nginx", "react", "vue", "next"}
# Ports used by the SDLC platform itself — remap generated app ports that clash.
_PLATFORM_PORTS = {3000, 5173, 8000, 8001}


def _fix_port_conflicts(compose_path: str) -> dict:
    """Rewrite docker-compose.yml, shifting any host port in _PLATFORM_PORTS by +10000.

    Returns a dict of {old_port: new_port} for each remapped port.
    """
    remapped: dict = {}
    try:
        with open(compose_path) as f:
            content = f.read()

        def _repl(m: re.Match) -> str:
            host = int(m.group(1))
            tail = m.group(2)  # ":CONTAINER_PORT"
            if host in _PLATFORM_PORTS:
                new_host = host + 10000
                remapped[host] = new_host
                return str(new_host) + tail
            return m.group(0)

        new_content = re.sub(r"(\d{2,5})(:\d{2,5})", _repl, content)

        # Rewrite any VITE_API_BASE_URL pointing to an absolute localhost URL
        # to a relative /api so requests flow through the Vite dev-server proxy
        # instead of hitting localhost:PORT directly in the browser.
        # Handles both YAML (key: value) and shell (KEY=value) forms.
        new_content = re.sub(
            r"(VITE_API_BASE_URL\s*[=:]\s*)['\"]?https?://localhost:\d+[^'\"\s\n]*['\"]?",
            r'\1"/api"',
            new_content,
        )

        if new_content != content:
            with open(compose_path, "w") as f:
                f.write(new_content)
    except Exception:
        pass
    return remapped

_DB_SERVICE_NAMES = {"postgres", "postgresql", "mysql", "mariadb", "redis", "mongo",
                     "mongodb", "elasticsearch", "rabbitmq", "memcached", "cassandra"}


def _get_backend_service(compose_text: str) -> Optional[tuple[str, int]]:
    """Return (service_name, container_port) for the backend API service.

    Excludes DB services and frontend services; returns the first candidate.
    """
    current_service: Optional[str] = None
    current_port: Optional[int] = None
    for line in compose_text.splitlines():
        svc_match = re.match(r'^  ([a-zA-Z0-9_-]+)\s*:', line)
        if svc_match:
            # Yield previous if it qualifies
            if current_service and current_port:
                svc_lower = current_service.lower()
                if (not any(k in svc_lower for k in _DB_SERVICE_NAMES) and
                        not any(k in svc_lower for k in _FRONTEND_NAMES)):
                    return current_service, current_port
            current_service = svc_match.group(1)
            current_port = None
        port_match = re.search(r"""['"]?\d{2,5}:(\d{2,5})['"]?""", line)
        if port_match and current_service:
            p = int(port_match.group(1))
            if p not in _DB_PORTS and current_port is None:
                current_port = p
    # Check last service
    if current_service and current_port:
        svc_lower = current_service.lower()
        if (not any(k in svc_lower for k in _DB_SERVICE_NAMES) and
                not any(k in svc_lower for k in _FRONTEND_NAMES)):
            return current_service, current_port
    return None


def _inject_vite_proxy(repo_dir: str, backend_service: str, backend_port: int) -> None:
    """Add an /api proxy to the frontend's vite.config.ts so the browser's relative
    /api requests are forwarded to the backend container via Docker's internal network.
    """
    for fname in ("vite.config.ts", "vite.config.js"):
        cfg_path = os.path.join(repo_dir, "frontend", fname)
        if not os.path.exists(cfg_path):
            continue
        try:
            with open(cfg_path) as f:
                content = f.read()
            if "proxy" in content:
                return  # Already configured
            proxy_block = (
                f"    proxy: {{\n"
                f"      '/api': {{\n"
                f"        target: 'http://{backend_service}:{backend_port}',\n"
                f"        changeOrigin: true,\n"
                f"      }},\n"
                f"    }},\n"
            )
            # Insert proxy block inside the server: { ... } section, after the last property
            # Strategy: find "    },\n})" which closes the server block and insert before it
            if "watch:" in content:
                new_content = content.replace(
                    "      usePolling: true,\n    },",
                    f"      usePolling: true,\n    }},\n{proxy_block}  ",
                )
            else:
                # Fallback: insert after "server: {"
                new_content = content.replace(
                    "server: {",
                    f"server: {{\n{proxy_block}",
                )
            if new_content != content:
                with open(cfg_path, "w") as f:
                    f.write(new_content)
        except Exception:
            pass
        return


def _detect_compose_port(compose_path: str) -> Optional[str]:
    """Return the best host port from docker-compose.yml.

    Priority:
    1. Port of a service whose name contains a frontend keyword
    2. First non-DB port in the file
    """
    try:
        with open(compose_path) as f:
            content = f.read()

        # Try to find a frontend service block and grab its first port
        # Simple block detection: find "  <name>:" at indent level 2, then look for ports
        current_service = None
        frontend_port: Optional[str] = None
        fallback_port: Optional[str] = None

        for line in content.splitlines():
            # Detect service name (2-space indent + name + colon, not deeper)
            svc_match = re.match(r'^  ([a-zA-Z0-9_-]+)\s*:', line)
            if svc_match:
                current_service = svc_match.group(1).lower()

            # Detect port mapping lines
            port_match = re.search(r"""['"]?(\d{2,5}):\d{2,5}['"]?""", line)
            if port_match:
                port = int(port_match.group(1))
                if port in _DB_PORTS:
                    continue
                if fallback_port is None:
                    fallback_port = str(port)
                if current_service and any(k in current_service for k in _FRONTEND_NAMES):
                    if frontend_port is None:
                        frontend_port = str(port)

        return frontend_port or fallback_port
    except Exception:
        pass
    return None


async def delivery_node(state: GraphState) -> GraphState:
    project_id = state["project_id"]
    state_doc = state["state_doc"]
    sm = StateManager()
    username = state_doc.username

    # Only proceed if at least one epic was successfully merged to main
    merged = [r for r in state_doc.epic_records if r.status == "COMPLETED" and r.merged_sha]
    if not merged:
        return state

    # # ========================================================
    # # 🟡 TEMPORARY MOCK FOR DELIVERY NODE
    # # ========================================================
    # import asyncio
    # print("🟡 MOCKING DELIVERY: Bypassing Git Clone & Docker Build...")
    
    # state_doc.delivery_status = "BUILDING"
    # sm.update_state(state_doc)
    
    # await emit(project_id, "DELIVERY_BUILDING", {
    #     "message": "Mocking Docker image build and port mapping...",
    # })

    # # Fake Docker Build Time
    # await asyncio.sleep(4)

    # # Fake successful deployment
    # delivery_url = "http://localhost:8080"
    # container_id = "mock-docker-container-abc123"

    # state_doc.delivery_url = delivery_url
    # state_doc.delivery_container_id = container_id
    # state_doc.delivery_status = "RUNNING"
    # sm.update_state(state_doc)

    # await emit(project_id, "PIPELINE_DELIVERED", {
    #     "delivery_url": delivery_url,
    #     "container_id": container_id,
    #     "message": f"Project is running at {delivery_url} (MOCKED)",
    # })

    # return {"project_id": project_id, "state_doc": sm.get_state(username,project_id)}

    repo = state_doc.github_repo or ""
    github_token = state_doc.github_token or ""
    branch = state_doc.github_branch or "main"

    if not repo:
        return state

    state_doc.delivery_status = "BUILDING"
    sm.update_state(state_doc)
    await emit(project_id, "DELIVERY_BUILDING", {
        "message": "Cloning final main branch and building Docker image…",
    })

    tmpdir = tempfile.mkdtemp(prefix=f"sdlc-delivery-{project_id[:12]}-")

    try:
        # Build authenticated clone URL
        slug = repo.replace("https://github.com/", "").replace("github.com/", "").rstrip("/")
        if github_token:
            clone_url = f"https://{github_token}@github.com/{slug}.git"
        else:
            clone_url = f"https://github.com/{slug}.git"

        rc, _, stderr = await _run(
            f"git clone --branch {branch} --depth 1 --config core.autocrlf=input {clone_url} repo",
            cwd=tmpdir,
        )
        if rc != 0:
            raise RuntimeError(f"git clone failed: {stderr[:400]}")

        repo_dir = os.path.join(tmpdir, "repo")

        # Strip any CRLF from shell scripts — Windows git may convert LF→CRLF
        # even with autocrlf=input if .gitattributes overrides it.
        import glob as _glob
        for sh_path in _glob.glob(os.path.join(repo_dir, "**", "*.sh"), recursive=True):
            try:
                with open(sh_path, "rb") as _f:
                    _content = _f.read()
                if b"\r\n" in _content:
                    with open(sh_path, "wb") as _f:
                        _f.write(_content.replace(b"\r\n", b"\n"))
            except Exception:
                pass

        # Detect docker-compose or Dockerfile
        compose_file: Optional[str] = None
        for name in ("docker-compose.yml", "docker-compose.yaml"):
            candidate = os.path.join(repo_dir, name)
            if os.path.exists(candidate):
                compose_file = candidate
                break

        has_dockerfile = os.path.exists(os.path.join(repo_dir, "Dockerfile"))

        if not compose_file and not has_dockerfile:
            await emit(project_id, "DELIVERY_NO_DOCKERFILE", {
                "message": (
                    "No Dockerfile or docker-compose.yml found in repo root. "
                    f"Run manually: git clone https://github.com/{slug}.git && "
                    "cd repo && docker-compose up --build"
                ),
            })
            state_doc.delivery_status = "FAILED"
            sm.update_state(state_doc)
            return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}

        # Remap any host ports that clash with the SDLC platform before building
        if compose_file:
            with open(compose_file) as _cf:
                _compose_text_pre = _cf.read()
            port_remap = _fix_port_conflicts(compose_file)
            if port_remap:
                await emit(project_id, "DELIVERY_BUILDING", {
                    "message": f"Remapped conflicting ports: {port_remap}",
                })
            # Inject Vite proxy so /api calls reach the backend via Docker network
            _backend = _get_backend_service(_compose_text_pre)
            if _backend:
                _inject_vite_proxy(repo_dir, _backend[0], _backend[1])

        # Stop any container from a previous delivery run
        if state_doc.delivery_container_id:
            await _run(f"docker stop {state_doc.delivery_container_id}", cwd=repo_dir)
            state_doc.delivery_container_id = None

        container_id: Optional[str] = None
        delivery_url: str

        # Inject operator-supplied secrets + delivery defaults into .env
        env_path = os.path.join(repo_dir, ".env")
        existing = ""
        if os.path.exists(env_path):
            with open(env_path) as f:
                existing = f.read()

        import secrets as _secrets
        extra: dict = {}

        # Inject sensible defaults for common required vars not present in .env
        user_vars = state_doc.project_env_vars or {}

        def _missing(key: str) -> bool:
            return key not in existing and key not in user_vars

        if compose_file:
            with open(compose_file) as f:
                compose_text = f.read()

            # Postgres credentials
            if "postgres" in compose_text.lower():
                if _missing("POSTGRES_PASSWORD"):
                    extra["POSTGRES_PASSWORD"] = "postgres"
                if _missing("POSTGRES_USER"):
                    extra["POSTGRES_USER"] = "postgres"
                if _missing("POSTGRES_DB"):
                    extra["POSTGRES_DB"] = "app"
                # Construct DATABASE_URL so ORMs can connect across docker network
                pg_user = user_vars.get("POSTGRES_USER", extra.get("POSTGRES_USER", "postgres"))
                pg_pass = user_vars.get("POSTGRES_PASSWORD", extra.get("POSTGRES_PASSWORD", "postgres"))
                pg_db   = user_vars.get("POSTGRES_DB",       extra.get("POSTGRES_DB",       "app"))
                db_url = f"postgresql://{pg_user}:{pg_pass}@postgres:5432/{pg_db}"
                if _missing("DATABASE_URL"):
                    extra["DATABASE_URL"] = db_url
                if _missing("DATABASE_URL_ASYNC"):
                    extra["DATABASE_URL_ASYNC"] = db_url.replace("postgresql://", "postgresql+asyncpg://")

        # Secret keys — generate a secure random value if not supplied
        for _key in ("JWT_SECRET_KEY", "SECRET_KEY", "APP_SECRET_KEY", "FLASK_SECRET_KEY"):
            if _missing(_key):
                extra[_key] = _secrets.token_hex(32)

        merged_vars = {**extra, **(state_doc.project_env_vars or {})}
        if merged_vars:
            with open(env_path, "w") as f:
                f.write(existing)
                for k, v in merged_vars.items():
                    f.write(f"\n{k}={v}")

        if compose_file:
            rc, stdout, stderr = await _run("docker-compose up -d --build", cwd=repo_dir)
            if rc != 0:
                raise RuntimeError(f"docker-compose up failed: {(stdout + stderr)[-600:]}")

            rc2, cid_out, _ = await _run("docker-compose ps -q", cwd=repo_dir)
            if rc2 == 0 and cid_out.strip():
                container_id = cid_out.strip().splitlines()[0]

            port = _detect_compose_port(compose_file) or "8080"
            delivery_url = f"http://localhost:{port}"

        else:
            image_tag = f"sdlc-{project_id[:12].lower()}"
            rc, _, stderr = await _run(f"docker build -t {image_tag} .", cwd=repo_dir)
            if rc != 0:
                raise RuntimeError(f"docker build failed: {stderr[-600:]}")

            rc, cid_out, stderr = await _run(f"docker run -d -P {image_tag}", cwd=repo_dir)
            if rc != 0:
                raise RuntimeError(f"docker run failed: {stderr[-400:]}")

            container_id = cid_out.strip()
            port = "8080"

            if container_id:
                rc2, inspect_out, _ = await _run(
                    f"docker port {container_id}",
                    cwd=repo_dir,
                )
                if rc2 == 0:
                    m = re.search(r"->.*:(\d+)", inspect_out)
                    if m:
                        port = m.group(1)

            delivery_url = f"http://localhost:{port}"

        state_doc.delivery_url = delivery_url
        state_doc.delivery_container_id = container_id
        state_doc.delivery_status = "RUNNING"
        sm.update_state(state_doc)

        await emit(project_id, "PIPELINE_DELIVERED", {
            "delivery_url": delivery_url,
            "container_id": container_id,
            "message": f"Project is running at {delivery_url}",
        })

    except Exception as exc:
        state_doc.delivery_status = "FAILED"
        sm.update_state(state_doc)
        await emit(project_id, "DELIVERY_FAILED", {
            "error": str(exc),
            "manual_instructions": (
                f"Automated delivery failed. To run manually: "
                f"git clone https://github.com/{repo}.git && "
                "cd repo && docker-compose up --build"
            ),
        })

    return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}
