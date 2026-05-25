import os
from dotenv import load_dotenv
from flask import Flask, render_template
from flask_cors import CORS

load_dotenv()


def create_app():
    app = Flask(__name__,
                template_folder='templates',
                static_folder='static')
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')

    CORS(app)

    from .database import init_db, close_db
    app.teardown_appcontext(close_db)

    with app.app_context():
        init_db()

    from .routes import bp as api_bp
    app.register_blueprint(api_bp)

    @app.route('/')
    def index():
        return render_template('index.html')

    return app
