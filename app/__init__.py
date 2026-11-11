import os
from dotenv import load_dotenv
from flask import Flask, send_from_directory, jsonify, Response

load_dotenv()


def create_app():
    app_dir = os.path.dirname(os.path.abspath(__file__))
    static_dir = os.path.join(app_dir, 'static')

    app = Flask(__name__, static_folder=static_dir)

    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')
    app.config['DEBUG'] = os.environ.get('DEBUG', 'False').lower() == 'true'

    from flask_cors import CORS
    CORS(app)

    from .database import init_db, close_db
    app.teardown_appcontext(close_db)

    try:
        with app.app_context():
            init_db()
    except Exception as e:
        print(f"Database initialization error: {e}")
        raise

    from .routes import bp as api_bp
    app.register_blueprint(api_bp)

    @app.route('/')
    def index():
        return send_from_directory(static_dir, 'index.html')

    @app.route('/health')
    def health():
        return jsonify({'status': 'ok'})

    # ---- PWA ----
    @app.route('/manifest.json')
    def manifest():
        return send_from_directory(static_dir, 'manifest.json', mimetype='application/manifest+json')

    @app.route('/sw.js')
    def service_worker():
        # Service Worker 必须由根路径提供，作用域才能覆盖整站
        resp = send_from_directory(static_dir, 'sw.js')
        resp.headers['Cache-Control'] = 'no-cache'
        resp.headers['Service-Worker-Allowed'] = '/'
        return resp

    @app.route('/icon.svg')
    def icon():
        return send_from_directory(static_dir, 'icon.svg', mimetype='image/svg+xml')

    return app
