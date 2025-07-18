# app.py - Advanced AI Content Platform
import os
import requests
import openai
import hmac
import hashlib
import base64
import uuid
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.exc import IntegrityError
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler

# --- CONFIGURATION ---
load_dotenv()
app = Flask(__name__)
app.config['SECRET_KEY'] = "6aG!v9@WnJz#q2P$KbX^E7LdM0o*T8rYdZp&sUeCcNwQfHbAjVlRtGiKmXbZnPo"
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///blog.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
UPLOAD_FOLDER = 'static/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# --- API & SERVICE KEYS ---
openai.api_key = os.getenv('OPENAI_API_KEY')
PEXELS_API_KEY = os.getenv('PEXELS_API_KEY')
# ... (FastSpring keys) ...

# --- DATABASE & LOGIN MANAGER ---
db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)

# ===================================================================
# --- DATABASE MODELS (ADVANCED) ---
# ===================================================================
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(150), nullable=False)
    ai_posts_remaining = db.Column(db.Integer, nullable=False, default=3)
    subscription_tier = db.Column(db.String(50), nullable=False, default='free') # free, pro, business
    posts = db.relationship('Post', backref='author', lazy=True)
    comments = db.relationship('Comment', backref='author', lazy=True)
    
    def set_password(self, password): self.password_hash = generate_password_hash(password)
    def check_password(self, password): return check_password_hash(self.password_hash, password)
    
    def to_dict(self): 
        return {'id': self.id, 'username': self.username, 'ai_posts_remaining': self.ai_posts_remaining, 'subscription_tier': self.subscription_tier}

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    image_url = db.Column(db.String(500), nullable=True, default="https://via.placeholder.com/800x400.png?text=Article+Image")
    category = db.Column(db.String(50), nullable=False)
    summary = db.Column(db.Text, nullable=True)
    seo_keywords = db.Column(db.String(255), nullable=True)
    date_posted = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    views = db.Column(db.Integer, default=0)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    comments = db.relationship('Comment', backref='post', lazy=True, cascade="all, delete-orphan")
    
    def to_dict(self):
        return {
            'id': self.id, 'title': self.title, 'content': self.content, 'image_url': self.image_url,
            'category': self.category, 'date_posted': self.date_posted.strftime('%Y-%m-%d %H:%M:%S'),
            'views': self.views, 'author': self.author.to_dict(), 'summary': self.summary,
            'seo_keywords': self.seo_keywords, 'comment_count': len(self.comments),
            'comments': [comment.to_dict() for comment in self.comments if comment.status == 'approved']
        }

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    date_posted = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False)
    status = db.Column(db.String(50), nullable=False, default='approved') # approved, pending, rejected
    
    def to_dict(self):
        return {'id': self.id, 'content': self.content, 'date_posted': self.date_posted.strftime('%Y-%m-%d'), 'author': self.author.to_dict()}

@login_manager.user_loader
def load_user(user_id): return User.query.get(int(user_id))

# --- HELPER FUNCTIONS ---
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ... (get_image_for_topic and generate_ai_post_content are the same as before) ...

# --- NEW: DALL-E Image Generation Helper ---
def generate_ai_image(prompt):
    if not openai.api_key: return None
    try:
        response = openai.images.generate(model="dall-e-3", prompt=f"A professional, cinematic blog header image for an article about: '{prompt}'. High quality, vibrant, minimalist.", n=1, size="1024x1024")
        return response.data[0].url
    except Exception as e:
        print(f"DALL-E Error: {e}")
        return None

# ===================================================================
# --- API Endpoints ---
# ===================================================================

@app.route('/')
def index(): return render_template('index.html')

# --- POST & COMMENT API ---
@app.route('/api/posts')
def api_get_posts():
    posts = Post.query.order_by(Post.date_posted.desc()).all()
    return jsonify([post.to_dict() for post in posts])

@app.route('/api/post/<int:post_id>')
def api_get_post(post_id):
    post = Post.query.get_or_404(post_id)
    post.views += 1
    db.session.commit()
    return jsonify(post.to_dict())

@app.route('/api/post/<int:post_id>/comment', methods=['POST'])
@login_required
def api_add_comment(post_id):
    post = Post.query.get_or_404(post_id)
    data = request.get_json()
    content = data.get('content')
    if not content: return jsonify({'error': 'Comment content is required'}), 400

    # AI Comment Moderation
    prompt = f"Is the following comment toxic, spam, or harmless? Respond with only one word: TOXIC, SPAM, or HARMLESS.\n\nComment: \"{content}\""
    response = openai.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}], max_tokens=5)
    moderation_result = response.choices[0].message.content.strip().upper()

    status = 'approved'
    if 'TOXIC' in moderation_result: status = 'rejected'
    if 'SPAM' in moderation_result: status = 'pending'
    
    comment = Comment(content=content, author=current_user, post=post, status=status)
    db.session.add(comment)
    db.session.commit()

    if status == 'approved':
        return jsonify(comment.to_dict()), 201
    else:
        return jsonify({'message': 'Comment submitted for moderation.'}), 202

# --- AUTH API (No changes) ---
# ... (register, login, logout, status, dashboard) ...

# --- AI GENERATION API ---
@app.route('/api/ai/generate_image', methods=['POST'])
@login_required
def api_generate_image():
    if current_user.subscription_tier == 'free': return jsonify({'error': 'Upgrade to Pro to use AI Image Generation'}), 403
    data = request.get_json()
    image_url = generate_ai_image(data.get('prompt'))
    if image_url: return jsonify({'success': True, 'file_url': image_url})
    else: return jsonify({'error': 'Failed to generate image'}), 500

@app.route('/api/ai/continue_writing', methods=['POST'])
@login_required
def api_ai_continue_writing():
    data = request.get_json()
    prompt = f"You are a blog writer. Here is the beginning of a blog post:\n\n{data.get('content', '')}\n\nContinue writing the next paragraph naturally."
    response = openai.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}], max_tokens=250)
    return jsonify({'text': response.choices[0].message.content.strip()})

@app.route('/api/ai/rephrase', methods=['POST'])
@login_required
def api_ai_rephrase():
    data = request.get_json()
    prompt = f"Rephrase the following text to sound more {data.get('tone', 'professional')}:\n\n{data.get('text', '')}"
    response = openai.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}], max_tokens=len(data.get('text', '')) + 50)
    return jsonify({'text': response.choices[0].message.content.strip()})
    
@app.route('/api/ai/generate_headlines', methods=['POST'])
@login_required
def api_ai_generate_headlines():
    data = request.get_json()
    prompt = f"Generate 5 catchy, SEO-friendly blog post titles based on the following article content:\n\n{data.get('content', '')}"
    response = openai.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}], max_tokens=150)
    headlines = [line.strip() for line in response.choices[0].message.content.strip().split('\n') if line.strip()]
    return jsonify({'headlines': headlines})
    
@app.route('/api/ai/seo_analysis', methods=['POST'])
@login_required
def api_ai_seo_analysis():
    data = request.get_json()
    prompt = f"Analyze the following blog post content and suggest 5 relevant SEO keywords. Also provide a readability score from 0 to 100. Format your response as: KEYWORDS: [keyword1, keyword2, ...]\n\nREADABILITY: [score]\n\nCONTENT:\n{data.get('content', '')}"
    # In a real app, you'd parse this properly. For now, we send the whole text.
    response = openai.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}], max_tokens=200)
    return jsonify({'analysis': response.choices[0].message.content.strip()})


# --- Other Endpoints (upload, manual post, AI generate, webhook, scheduler) ---
# ... (all other endpoints from the previous version remain here) ...


# --- MAIN EXECUTION ---
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True)