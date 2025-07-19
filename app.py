from flask import Flask, jsonify, request, session, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import timedelta, datetime
import os
import requests
import openai
import json
import atexit
from dotenv import load_dotenv
from newsapi import NewsApiClient
from apscheduler.schedulers.background import BackgroundScheduler

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Use environment variables for configuration
app.secret_key = os.getenv('SECRET_KEY', 'super-secret-key-fallback')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///blog.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

db = SQLAlchemy(app)
CORS(app)

# Initialize API clients
openai_api_key = os.getenv('OPENAI_API_KEY')
openai_client = openai.OpenAI(api_key=openai_api_key) if openai_api_key else None
if not openai_client:
    print("Warning: OPENAI_API_KEY not found in .env. AI generation will not work.")

PEXELS_API_KEY = os.getenv('PEXELS_API_KEY')
if not PEXELS_API_KEY:
    print("Warning: PEXELS_API_KEY not found in .env. Pexels image search will not work.")

NEWS_API_KEY = os.getenv('NEWS_API_KEY')
newsapi_client = NewsApiClient(api_key=NEWS_API_KEY) if NEWS_API_KEY else None
if not newsapi_client:
    print("Warning: NEWS_API_KEY not found in .env. News fetching will not work.")

# FastSpring Configuration
FASTSPRING_STORE_SUBDOMAIN = os.getenv('FASTSPRING_STORE_SUBDOMAIN')
FASTSPRING_PRODUCT_PATH = os.getenv('FASTSPRING_PRODUCT_PATH')
FASTSPRING_WEBHOOK_SECRET = os.getenv('FASTSPRING_WEBHOOK_SECRET')

# Define categories for news fetching
NEWS_CATEGORIES = ['general', 'sports', 'politics', 'gaming', 'entertainment', 'technology', 'science', 'health']

# Free tier limit for user-generated AI posts
FREE_TIER_AI_POSTS_LIMIT = 3

# --- Placeholder for AI User (for scheduled posts) ---
AI_USER_ID = None

# --------------------- Main Route for Frontend --------------------- #
@app.route('/')
def index():
    return render_template('index.html')

# --------------------- Models --------------------- #

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(100), nullable=False)
    is_premium = db.Column(db.Boolean, default=False, nullable=False)
    ai_posts_generated_count = db.Column(db.Integer, default=0, nullable=False)
    posts = db.relationship('Post', backref='author', lazy=True)

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    image_url = db.Column(db.String(300))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    views = db.Column(db.Integer, default=0, nullable=False)
    is_ai_generated = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

# --------------------- Auth Routes --------------------- #

@app.route('/api/signup', methods=['POST'])
def signup():
    data = request.json
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Username already exists'}), 400
    user = User(username=data['username'], password=data['password'])
    db.session.add(user)
    db.session.commit()
    session['user_id'] = user.id
    return jsonify({
        'id': user.id,
        'username': user.username,
        'is_premium': user.is_premium,
        'ai_posts_generated_count': user.ai_posts_generated_count,
        'free_tier_ai_limit': FREE_TIER_AI_POSTS_LIMIT
    })

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data['username'], password=data['password']).first()
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    session['user_id'] = user.id
    return jsonify({
        'id': user.id,
        'username': user.username,
        'is_premium': user.is_premium,
        'ai_posts_generated_count': user.ai_posts_generated_count,
        'free_tier_ai_limit': FREE_TIER_AI_POSTS_LIMIT
    })

@app.route('/api/logout')
def logout():
    session.clear()
    return jsonify({'message': 'Logged out'})

@app.route('/api/me')
def get_current_user():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify(None)
    user = User.query.get(user_id)
    if not user:
        session.clear()
        return jsonify(None)
    
    db.session.refresh(user)
    
    return jsonify({
        'id': user.id,
        'username': user.username,
        'is_premium': user.is_premium,
        'ai_posts_generated_count': user.ai_posts_generated_count,
        'free_tier_ai_limit': FREE_TIER_AI_POSTS_LIMIT
    })

# --------------------- Post Routes --------------------- #

@app.route('/api/posts', methods=['GET'])
def get_posts():
    search_query = request.args.get('query')
    posts_query = Post.query.order_by(Post.created_at.desc())
    if search_query:
        posts_query = posts_query.filter(
            (Post.title.ilike(f'%{search_query}%')) |
            (Post.content.ilike(f'%{search_query}%'))
        )
    posts = posts_query.all()
    return jsonify([
        {'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': post.author.username, 'user_id': post.user_id, 'views': post.views, 'is_ai_generated': post.is_ai_generated}
        for post in posts
    ])

@app.route('/api/posts/<int:post_id>', methods=['GET'])
def get_post(post_id):
    post = Post.query.get_or_404(post_id)
    post.views += 1
    db.session.commit()
    return jsonify({'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': post.author.username, 'user_id': post.user_id, 'views': post.views, 'is_ai_generated': post.is_ai_generated})

@app.route('/api/posts', methods=['POST'])
def create_post():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    is_ai_generated = data.get('is_ai_generated', False)
    
    user = User.query.get(user_id)
    
    # The count is now incremented in generate_ai_post_manual BEFORE this is called.
    # No changes are needed here for the count.
        
    post = Post(title=data['title'], content=data['content'], image_url=data.get('image_url'), user_id=user_id, views=0, is_ai_generated=is_ai_generated)
    db.session.add(post)
    db.session.commit()

    # Refresh user to ensure we send back the latest state
    db.session.refresh(user)

    return jsonify({
        'id': post.id,
        'title': post.title,
        'user': {
            'id': user.id,
            'username': user.username,
            'is_premium': user.is_premium,
            'ai_posts_generated_count': user.ai_posts_generated_count,
            'free_tier_ai_limit': FREE_TIER_AI_POSTS_LIMIT
        }
    })


@app.route('/api/me/posts', methods=['GET'])
def get_my_posts():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401
    my_posts = Post.query.filter_by(user_id=user_id).order_by(Post.created_at.desc()).all()
    return jsonify([
        {'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': post.author.username, 'user_id': post.user_id, 'views': post.views, 'is_ai_generated': post.is_ai_generated}
        for post in my_posts
    ])

@app.route('/api/users/<int:user_id>/posts', methods=['GET'])
def get_posts_by_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    search_query = request.args.get('query')
    posts_query = Post.query.filter_by(user_id=user_id).order_by(Post.created_at.desc())
    if search_query:
        posts_query = posts_query.filter(
            (Post.title.ilike(f'%{search_query}%')) |
            (Post.content.ilike(f'%{search_query}%'))
        )
    user_posts = posts_query.all()
    return jsonify([
        {'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': user.username, 'user_id': post.user_id, 'views': post.views, 'is_ai_generated': post.is_ai_generated}
        for post in user_posts
    ])

@app.route('/api/posts/<int:post_id>', methods=['PUT'])
def update_post(post_id):
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401
    post = Post.query.get_or_404(post_id)
    if post.user_id != user_id:
        return jsonify({'error': 'Forbidden: You do not own this post'}), 403
    data = request.json
    post.title = data.get('title', post.title)
    post.content = data.get('content', post.content)
    post.image_url = data.get('image_url', post.image_url)
    db.session.commit()
    return jsonify({'message': 'Post updated successfully', 'id': post.id})

@app.route('/api/posts/<int:post_id>', methods=['DELETE'])
def delete_post(post_id):
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401
    post = Post.query.get_or_404(post_id)
    if post.user_id != user_id:
        return jsonify({'error': 'Forbidden: You do not own this post'}), 403
    db.session.delete(post)
    db.session.commit()
    return jsonify({'message': 'Post deleted successfully', 'id': post.id})

@app.route('/api/trending_ai_posts', methods=['GET'])
def get_trending_ai_posts():
    ai_posts = Post.query.filter_by(is_ai_generated=True).order_by(Post.created_at.desc()).limit(3).all()
    if not ai_posts:
        ai_posts = Post.query.order_by(Post.created_at.desc()).limit(3).all()
    return jsonify([
        {'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': post.author.username, 'user_id': post.user_id, 'views': post.views, 'is_ai_generated': post.is_ai_generated}
        for post in ai_posts
    ])

# --------------------- AI Generation & News Fetching Logic --------------------- #

def generate_ai_content(prompt):
    if not openai_client:
        return None, None, "OpenAI API key is not configured."
    try:
        response = openai_client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful blog post assistant. Generate a blog post title and content based on the user's prompt. Provide the output in a JSON format with 'title' and 'content' keys. Keep the content detailed and suitable for a general audience. The content should be at least 200 words."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1500
        )
        ai_output = response.choices[0].message.content
        try:
            parsed_output = json.loads(ai_output)
            return parsed_output.get('title'), parsed_output.get('content'), None
        except json.JSONDecodeError:
            print(f"Error decoding AI response: {ai_output}")
            return None, None, "Failed to parse AI response."
    except openai.APIError as e:
        print(f"OpenAI API error: {e}")
        return None, None, f"OpenAI API error: {e}"
    except Exception as e:
        print(f"An unexpected error occurred during AI generation: {e}")
        return None, None, f"An unexpected error occurred: {e}"

def search_pexels_image(query):
    if not PEXELS_API_KEY:
        return None
    try:
        headers = {'Authorization': PEXELS_API_KEY}
        params = {'query': query, 'per_page': 1, 'orientation': 'landscape'}
        response = requests.get('https://api.pexels.com/v1/search', headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        if data and data['photos']:
            return data['photos'][0]['src']['large']
        return None
    except requests.exceptions.RequestException as e:
        print(f"Pexels API request failed: {e}")
        return None
    except Exception as e:
        print(f"An error occurred during Pexels image search: {e}")
        return None

@app.route('/api/generate_ai_post', methods=['POST'])
def generate_ai_post_manual():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    prompt = data.get('prompt')
    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    user = User.query.get(user_id)
    db.session.refresh(user)
    
    if not user.is_premium and user.ai_posts_generated_count >= FREE_TIER_AI_POSTS_LIMIT:
        print(f"[DEBUG - generate_ai_post_manual] FREE TIER LIMIT HIT for {user.username}! Blocking generation.")
        return jsonify({'error': f'Free tier limit reached ({FREE_TIER_AI_POSTS_LIMIT} AI posts). Upgrade to premium for unlimited AI post generation.'}), 403

    title, content, ai_error = generate_ai_content(prompt)
    if ai_error:
        return jsonify({'error': ai_error}), 500
    if not title or not content:
        return jsonify({'error': 'Failed to generate content from AI. Please try a different prompt.'}), 500

    if not user.is_premium:
        user.ai_posts_generated_count += 1
        db.session.add(user)
        db.session.commit()
        print(f"[DEBUG - generate_ai_post_manual] User '{user.username}' count incremented to {user.ai_posts_generated_count} and committed.")

    image_url = search_pexels_image(title.split(':')[0].strip())

    return jsonify({
        'title': title,
        'content': content,
        'image_url': image_url
    })

def fetch_news_and_generate_posts():
    with app.app_context():
        print(f"[{datetime.now()}] Running daily AI post generation job...")
        if not newsapi_client:
            print("NewsAPI client not initialized. Skipping news fetch.")
            return
        if not openai_client:
            print("OpenAI client not initialized. Skipping AI generation.")
            return
        
        global AI_USER_ID
        if AI_USER_ID is None:
            ai_user = User.query.filter_by(username='ai_writer').first()
            if not ai_user:
                ai_user = User(username='ai_writer', password=os.urandom(16).hex())
                db.session.add(ai_user)
                db.session.commit()
                print("Created 'ai_writer' user for automated posts.")
            AI_USER_ID = ai_user.id
        
        for category in NEWS_CATEGORIES:
            try:
                top_headlines = newsapi_client.get_top_headlines(category=category, language='en', country='us', page_size=1)
                articles = top_headlines['articles']
                if not articles:
                    print(f"No articles found for category: {category}")
                    continue
                article = articles[0]
                news_title = article.get('title')
                news_description = article.get('description') or news_title
                if not news_title or news_title == '[Removed]':
                    print(f"Skipping article due to missing or removed title in category: {category}")
                    continue
                prompt = f"Write a compelling blog post about the following news article:\n\nTitle: \"{news_title}\"\nDescription: \"{news_description}\"\n\nMake it engaging and informative, about 300-500 words. Include an introduction, a few body paragraphs, and a conclusion. Do not include external links unless explicitly asked."
                blog_title, blog_content, ai_error = generate_ai_content(prompt)
                if ai_error:
                    print(f"AI generation failed for news: {news_title}. Error: {ai_error}")
                    continue
                if not blog_title or not blog_content:
                    print(f"AI generated empty title or content for news: {news_title}")
                    continue
                image_query = news_title.split(':')[0].strip()
                image_url = search_pexels_image(image_query)
                if not image_url:
                    print(f"No Pexels image found for query: {image_query}")
                new_post = Post(
                    title=blog_title,
                    content=blog_content,
                    image_url=image_url,
                    user_id=AI_USER_ID,
                    views=0,
                    is_ai_generated=True,
                    created_at=datetime.utcnow()
                )
                db.session.add(new_post)
                db.session.commit()
                print(f"Successfully generated and saved AI post: '{blog_title}' from category '{category}'")
            except Exception as e:
                db.session.rollback()
                print(f"Error generating post for category {category}: {e}")
        print(f"[{datetime.now()}] Daily AI post generation job finished.")

# --------------------- Statistics and Premium Routes --------------------- #

@app.route('/api/stats', methods=['GET'])
def get_global_stats():
    total_users = User.query.count()
    total_posts = Post.query.count()
    total_views = db.session.query(db.func.sum(Post.views)).scalar() or 0
    return jsonify({
        'total_users': total_users,
        'total_posts': total_posts,
        'total_views': total_views
    })

@app.route('/api/me/stats', methods=['GET'])
def get_user_stats():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401
    
    user = User.query.get(user_id)
    if not user:
        session.clear()
        return jsonify({'error': 'User not found'}), 404
    
    db.session.refresh(user)

    user_posts_count = Post.query.filter_by(user_id=user_id).count()
    user_total_views = db.session.query(db.func.sum(Post.views)).filter_by(user_id=user_id).scalar() or 0
    user_ai_posts_count = user.ai_posts_generated_count
    
    return jsonify({
        'username': user.username,
        'is_premium': user.is_premium,
        'posts_count': user_posts_count,
        'total_views_on_posts': user_total_views,
        'ai_posts_generated_count': user_ai_posts_count,
        'free_tier_ai_limit': FREE_TIER_AI_POSTS_LIMIT
    })

@app.route('/api/fastspring/checkout', methods=['POST'])
def create_fastspring_checkout():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401

    user = User.query.get(user_id)
    if not user:
        session.clear()
        return jsonify({'error': 'User not found'}), 404

    if user.is_premium:
        return jsonify({'error': 'User is already premium'}), 400

    if not FASTSPRING_STORE_SUBDOMAIN or not FASTSPRING_PRODUCT_PATH:
        return jsonify({'error': 'FastSpring configuration missing in .env'}), 500

    checkout_url = (
        f"https://{FASTSPRING_STORE_SUBDOMAIN}.onfastspring.com/{FASTSPRING_PRODUCT_PATH}?"
        f"customer[email]={user.username}@example.com&"
        f"tags=user_id_{user_id}&"
        f"referrer={request.url_root}"
    )
    return jsonify({'checkout_url': checkout_url})

@app.route('/api/fastspring/webhook', methods=['POST'])
def fastspring_webhook_handler():
    data = request.json
    print(f"FastSpring Webhook Received: {data}")
    
    for event in data.get('events', []):
        if event.get('type') == 'order.completed' or event.get('type') == 'subscription.activated':
            tags = event['data'].get('tags', [])
            user_id_from_tag = None
            for tag in tags:
                if tag.startswith('user_id_'):
                    try:
                        user_id_from_tag = int(tag.split('_')[1])
                        break
                    except (ValueError, IndexError):
                        continue
            
            if user_id_from_tag:
                user = User.query.get(user_id_from_tag)
                if user:
                    user.is_premium = True
                    user.ai_posts_generated_count = 0 
                    db.session.commit()
                    print(f"User {user.username} (ID: {user.id}) marked as premium via webhook. AI posts count reset.")
                else:
                    print(f"Webhook: User with ID {user_id_from_tag} not found.")
            else:
                print("Webhook: User ID not found in tags for order/subscription event.")

    return jsonify({'status': 'success'}), 200

# --------------------- Run App and Scheduler --------------------- #

# --- MOVED SCHEDULER SETUP TO THE END ---

def create_tables_and_seed_ai_user():
    with app.app_context():
        # IMPORTANT: Uncomment db.drop_all() for one run to re-create the database.
        # This will delete ALL existing users and posts!
        db.drop_all() # <-- TEMPORARILY UNCOMMENTED FOR THE FIX
        db.create_all()
        print("\n!!! DATABASE TABLES DROPPED AND RECREATED. PLEASE RE-COMMENT 'db.drop_all()' AFTER THIS RUN. !!!\n")

        global AI_USER_ID
        ai_user = User.query.filter_by(username='ai_writer').first()
        if not ai_user:
            ai_user = User(username='ai_writer', password=os.urandom(16).hex())
            db.session.add(ai_user)
            db.session.commit()
            print("Created 'ai_writer' user for automated posts.")
        AI_USER_ID = ai_user.id

if __name__ == '__main__':
    create_tables_and_seed_ai_user()

    # --- MOVED SCHEDULER SETUP TO HERE, AFTER FUNCTIONS ARE DEFINED ---
    scheduler = BackgroundScheduler()
    scheduler.add_job(fetch_news_and_generate_posts, 'interval', minutes=5)
    
    scheduler.start()
    print("Scheduler started. AI posts will be generated automatically.")
    
    atexit.register(lambda: scheduler.shutdown())

    app.run(debug=True)