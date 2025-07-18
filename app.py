# app.py - Full Code
import os
import requests
import openai
import hmac
import hashlib
import base64
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, render_template, request, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, SubmitField, TextAreaField
from wtforms.validators import DataRequired, EqualTo, Length
from apscheduler.schedulers.background import BackgroundScheduler

# --- CONFIGURATION ---
# Load all the variables from our .env file
load_dotenv()
app = Flask(__name__)
app.config['SECRET_KEY'] = "6aG!v9@WnJz#q2P$KbX^E7LdM0o*T8rYdZp&sUeCcNwQfHbAjVlRtGiKmXbZnPo"
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///blog.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# --- API & SERVICE KEYS ---
# Set up the API keys for our services
openai.api_key = os.getenv('OPENAI_API_KEY')
PEXELS_API_KEY = os.getenv('PEXELS_API_KEY')
FASTSPRING_STORE_SUBDOMAIN = os.getenv('FASTSPRING_STORE_SUBDOMAIN')
FASTSPRING_PRODUCT_PATH = os.getenv('FASTSPRING_PRODUCT_PATH')
FASTSPRING_WEBHOOK_SECRET = os.getenv('FASTSPRING_WEBHOOK_SECRET')

# --- DATABASE SETUP ---
db = SQLAlchemy(app)

# Database Model for Users
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(150), nullable=False)
    posts = db.relationship('Post', backref='author', lazy=True)
    def set_password(self, password): self.password_hash = generate_password_hash(password)
    def check_password(self, password): return check_password_hash(self.password_hash, password)

# Database Model for Blog Posts
class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    image_url = db.Column(db.String(500), nullable=True, default="https://via.placeholder.com/800x400.png?text=Article+Image")
    category = db.Column(db.String(50), nullable=False)
    date_posted = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    views = db.Column(db.Integer, default=0)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

# --- LOGIN MANAGER ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login' # Redirect to /login if user is not logged in
@login_manager.user_loader
def load_user(user_id): return User.query.get(int(user_id))

# --- FORMS (using Flask-WTF) ---
class RegistrationForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired(), Length(min=4, max=20)])
    password = PasswordField('Password', validators=[DataRequired(), Length(min=6)])
    confirm_password = PasswordField('Confirm Password', validators=[DataRequired(), EqualTo('password')])
    submit = SubmitField('Sign Up')

class LoginForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired()])
    password = PasswordField('Password', validators=[DataRequired()])
    submit = SubmitField('Login')

class PostForm(FlaskForm):
    title = StringField('Title', validators=[DataRequired()])
    content = TextAreaField('Content', validators=[DataRequired()])
    category = StringField('Category', validators=[DataRequired()])
    submit = SubmitField('Create Post')

# --- AI & IMAGE HELPER FUNCTIONS ---
def get_image_for_topic(topic):
    if not PEXELS_API_KEY: return "https://via.placeholder.com/800x400.png?text=Pexels+API+Key+Missing"
    try:
        headers = {"Authorization": PEXELS_API_KEY}
        response = requests.get(f"https://api.pexels.com/v1/search?query={topic}&per_page=1&orientation=landscape", headers=headers)
        if response.status_code == 200 and response.json()['photos']:
            return response.json()['photos'][0]['src']['large']
    except Exception as e: print(f"Pexels API Error: {e}")
    return "https://via.placeholder.com/800x400.png?text=Image+Not+Found"

def generate_ai_post_content(topic, category):
    if not openai.api_key or "YOUR_OPENAI_KEY" in openai.api_key:
        return {"title": f"Placeholder: {topic}", "content": "OpenAI API key is missing or invalid."}
    try:
        prompt = f"Write a compelling blog post about '{topic}' for the '{category}' category. Format the output as: TITLE: [Your Title Here]\n\nCONTENT: [Your Content Here]"
        response = openai.Completion.create(engine="text-davinci-003", prompt=prompt, max_tokens=500, temperature=0.7)
        full_text = response.choices[0].text.strip()
        title = full_text.split("TITLE:")[1].split("\n\nCONTENT:")[0].strip()
        content = full_text.split("\n\nCONTENT:")[1].strip()
        return {"title": title, "content": content}
    except Exception as e:
        print(f"OpenAI API Error: {e}")
        return {"title": f"Error: Could not generate post on {topic}", "content": "The AI service may be temporarily unavailable."}

# --- STANDARD PAGE ROUTES ---
@app.route('/')
def index():
    page = request.args.get('page', 1, type=int)
    posts = Post.query.order_by(Post.date_posted.desc()).paginate(page=page, per_page=5)
    return render_template('index.html', posts=posts)

@app.route('/post/<int:post_id>')
def post_detail(post_id):
    post = Post.query.get_or_404(post_id)
    post.views += 1; db.session.commit()
    return render_template('post_detail.html', post=post)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated: return redirect(url_for('index'))
    form = RegistrationForm();
    if form.validate_on_submit():
        user = User(username=form.username.data); user.set_password(form.password.data)
        db.session.add(user); db.session.commit()
        flash('Registration successful! Please log in.', 'success'); return redirect(url_for('login'))
    return render_template('register.html', form=form)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('index'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=True); return redirect(url_for('index'))
        else: flash('Login failed. Check username and password.', 'danger')
    return render_template('login.html', form=form)

@app.route('/logout')
@login_required
def logout(): logout_user(); return redirect(url_for('index'))

@app.route('/create_post', methods=['GET', 'POST'])
@login_required
def create_post():
    form = PostForm()
    if form.validate_on_submit():
        image_url = get_image_for_topic(form.title.data)
        post = Post(title=form.title.data, content=form.content.data, category=form.category.data, author=current_user, image_url=image_url)
        db.session.add(post); db.session.commit()
        flash('Your post has been created!', 'success'); return redirect(url_for('index'))
    return render_template('create_post.html', form=form)

@app.route('/dashboard')
@login_required
def dashboard():
    posts = Post.query.filter_by(user_id=current_user.id).all()
    total_views = sum(post.views for post in posts)
    earnings = (total_views / 1000) * 5.0 # $5 per 1000 views simulation
    return render_template('dashboard.html', posts=posts, total_views=total_views, earnings=earnings)

# --- FASTSPRING PAYMENT ROUTES ---
@app.route('/ai-post-generator')
@login_required
def ai_post_generator():
    return render_template('ai_generator_page.html')

@app.route('/generate-fastspring-link', methods=['POST'])
@login_required
def generate_fastspring_link():
    topic = request.form['topic']; category = request.form['category']
    tags = f"user_id={current_user.id},topic={topic},category={category}"
    fastspring_url = f"https://{FASTSPRING_STORE_SUBDOMAIN}.onfastspring.com/{FASTSPRING_PRODUCT_PATH}?tags={tags}"
    return redirect(fastspring_url)

# This is where FastSpring sends its notification after a successful payment
@app.route('/fastspring-webhook', methods=['POST'])
def fastspring_webhook():
    fs_signature = request.headers.get('X-Fs-Signature')
    if not fs_signature: return "Missing signature", 401
    
    payload_body = request.get_data()
    key = FASTSPRING_WEBHOOK_SECRET.encode('utf-8')
    expected_signature = base64.b64encode(hashlib.md5(payload_body + key).digest()).decode('utf-8')

    if not hmac.compare_digest(fs_signature, expected_signature):
        print("Webhook verification failed!")
        return "Invalid signature", 401
    
    data = request.get_json()
    for event in data['events']:
        if event['type'] == 'order.completed':
            try:
                tags = dict(item.split("=") for item in event['data']['items'][0]['tags'].split(","))
                user = User.query.get(int(tags['user_id']))
                if user:
                    ai_content = generate_ai_post_content(tags['topic'], tags['category'])
                    image_url = get_image_for_topic(tags['topic'])
                    post = Post(title=ai_content['title'], content=ai_content['content'], image_url=image_url, category=tags['category'], author=user)
                    db.session.add(post); db.session.commit()
                    print(f"WEBHOOK: Successfully created post '{ai_content['title']}' for user {user.username}")
            except Exception as e: print(f"Webhook processing error: {e}")
    return "Webhook received", 200

# --- AUTOMATED DAILY POST SCHEDULER ---
def automated_daily_post():
    with app.app_context():
        # Assign the post to the first user in the database. 
        # In a real app, you might have a dedicated 'Admin' or 'AI' user.
        ai_user = User.query.first()
        if not ai_user: 
            print("SCHEDULER: Cannot run, no users in database to assign post to.")
            return

        print("SCHEDULER: Running daily automated post job...")
        topic = "Breaking News in Artificial Intelligence Today"
        ai_content = generate_ai_post_content(topic, "Daily News")
        image_url = get_image_for_topic(topic)
        post = Post(title=ai_content['title'], content=ai_content['content'], image_url=image_url, category="Daily News", author=ai_user)
        db.session.add(post); db.session.commit()
        print(f"SCHEDULER: Successfully created post '{ai_content['title']}'")

scheduler = BackgroundScheduler(daemon=True)
scheduler.add_job(automated_daily_post, 'interval', hours=24) # Change hours to seconds for testing
scheduler.start()

# --- MAIN EXECUTION ---
# This block runs only when you execute "py app.py" directly
if __name__ == '__main__':
    with app.app_context():
        db.create_all() # This creates the database file and tables if they don't exist
    app.run(debug=True) # Runs the app in debug mode for development