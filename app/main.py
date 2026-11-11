import os
import socket
from app import create_app

app = create_app()


def find_free_port(start, count=5):
    """从 start 开始尝试找最多 count 个可用端口"""
    for offset in range(count):
        port = start + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(('0.0.0.0', port))
                return port
            except OSError:
                continue
    return None


if __name__ == '__main__':
    debug = os.environ.get('DEBUG', 'True').lower() == 'true'
    env_port = os.environ.get('PORT')

    if env_port:
        port = int(env_port)
    else:
        port = find_free_port(5001)
        if port is None:
            print("[ERROR] No free port found in range 5001-5005.")
            raise SystemExit(1)

    print(f"[*] Starting Media Tracker on http://127.0.0.1:{port}")
    app.run(host='0.0.0.0', port=port, debug=debug)
