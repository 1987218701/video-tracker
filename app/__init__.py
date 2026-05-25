import os
from dotenv import load_dotenv
from flask import Flask, render_template, jsonify
from flask_cors import CORS

load_dotenv()


def create_app():
    app_dir = os.path.dirname(os.path.abspath(__file__))
    template_dir = os.path.join(app_dir, 'templates')
    static_dir = os.path.join(app_dir, 'static')
    
    app = Flask(__name__,
                template_folder=template_dir,
                static_folder=static_dir)
    
    # 修改 Jinja2 分隔符，避免与 Vue 冲突
    app.jinja_env.variable_start_string = '{@'
    app.jinja_env.variable_end_string = '@}'
    app.jinja_env.block_start_string = '{%%'
    app.jinja_env.block_end_string = '%%}'
    app.jinja_env.comment_start_string = '{#'
    app.jinja_env.comment_end_string = '#}'
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')
    app.config['DEBUG'] = os.environ.get('DEBUG', 'False').lower() == 'true'

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
        return render_template('index.html')

    @app.route('/health')
    def health():
        return jsonify({'status': 'ok'})

    return app
