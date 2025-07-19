from flask import Flask, jsonify, request, session, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import timedelta
import os
import requests
import openai
from dotenv import load_dotenv

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

# Initialize OpenAI client
openai_api_key = os.getenv('OPENAI_API_KEY')
if not openai_api_key:
    print("Warning: OPENAI_API_KEY not found in .env. AI generation will not work.")
    openai_client = None
else:
    openai_client = openai.OpenAI(api_key=openai_api_key)

PEXELS_API_KEY = os.getenv('PEXELS_API_KEY')
if not PEXELS_API_KEY:
    print("Warning: PEXELS_API_KEY not found in .env. Pexels image search will not work.")

# FastSpring Configuration
FASTSPRING_STORE_SUBDOMAIN = os.getenv('FASTSPRING_STORE_SUBDOMAIN')
FASTSPRING_PRODUCT_PATH = os.getenv('FASTSPRING_PRODUCT_PATH')
FASTSPRING_WEBHOOK_SECRET = os.getenv('FASTSPRING_WEBHOOK_SECRET') # For webhook signature verification (advanced)

# --------------------- Main Route for Frontend --------------------- #
@app.route('/')
def index():
    return render_template('index.html')

# --------------------- Models --------------------- #

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(100), nullable=False)
    is_premium = db.Column(db.Boolean, default=False, nullable=False) # NEW: Premium status
    posts = db.relationship('Post', backref='author', lazy=True)

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    image_url = db.Column(db.String(300))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    views = db.Column(db.Integer, default=0, nullable=False)

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
    return jsonify({'id': user.id, 'username': user.username, 'is_premium': user.is_premium}) # Return premium status

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data['username'], password=data['password']).first()
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    session['user_id'] = user.id
    return jsonify({'id': user.id, 'username': user.username, 'is_premium': user.is_premium}) # Return premium status

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

    return jsonify({'id': user.id, 'username': user.username, 'is_premium': user.is_premium}) # Return premium status

# --------------------- Post Routes --------------------- #
# ... (These routes remain mostly the same, ensuring 'views' and 'user_id' are returned) ...

@app.route('/api/posts', methods=['GET'])
def get_posts():
    search_query = request.args.get('query')
    posts_query = Post.query.order_by(Post.id.desc())
    if search_query:
        posts_query = posts_query.filter(
            (Post.title.ilike(f'%{search_query}%')) |
            (Post.content.ilike(f'%{search_query}%'))
        )
    posts = posts_query.all()
    return jsonify([
        {'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': post.author.username, 'user_id': post.user_id, 'views': post.views}
        for post in posts
    ])

@app.route('/api/posts/<int:post_id>', methods=['GET'])
def get_post(post_id):
    post = Post.query.get_or_404(post_id)
    post.views += 1
    db.session.commit()
    return jsonify({'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': post.author.username, 'user_id': post.user_id, 'views': post.views})

@app.route('/api/posts', methods=['POST'])
def create_post():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    # Optional: Implement a premium check for AI posts if desired
    # user = User.query.get(user_id)
    # if data.get('is_ai_generated') and not user.is_premium:
    #    return jsonify({'error': 'Premium account required for AI generation'}), 403

    post = Post(title=data['title'], content=data['content'], image_url=data.get('image_url'), user_id=user_id, views=0)
    db.session.add(post)
    db.session.commit()
    return jsonify({'id': post.id, 'title': post.title})

@app.route('/api/me/posts', methods=['GET'])
def get_my_posts():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401
    my_posts = Post.query.filter_by(user_id=user_id).order_by(Post.id.desc()).all()
    return jsonify([
        {'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': post.author.username, 'user_id': post.user_id, 'views': post.views}
        for post in my_posts
    ])

@app.route('/api/users/<int:user_id>/posts', methods=['GET'])
def get_posts_by_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    search_query = request.args.get('query')
    posts_query = Post.query.filter_by(user_id=user_id).order_by(Post.id.desc())
    if search_query:
        posts_query = posts_query.filter(
            (Post.title.ilike(f'%{search_query}%')) |
            (Post.content.ilike(f'%{search_query}%'))
        )
    user_posts = posts_query.all()
    return jsonify([
        {'id': post.id, 'title': post.title, 'content': post.content, 'image_url': post.image_url, 'username': user.username, 'user_id': post.user_id, 'views': post.views}
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


# --------------------- AI Generation Routes --------------------- #

def generate_ai_content(prompt):
    if not openai_client:
        return None, None, "OpenAI API key is not configured."
    try:
        response = openai_client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful blog post assistant. Generate a blog post title and content based on the user's prompt. Provide the output in a JSON format with 'title' and 'content' keys. Keep the content detailed."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1000
        )
        ai_output = response.choices[0].message.content
        import json
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
def generate_ai_post():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    prompt = data.get('prompt')
    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    # Optional: Add premium check for AI generation
    # user = User.query.get(user_id)
    # if not user.is_premium:
    #    return jsonify({'error': 'Premium account required for AI post generation'}), 403

    title, content, ai_error = generate_ai_content(prompt)
    if ai_error:
        return jsonify({'error': ai_error}), 500
    if not title or not content:
        return jsonify({'error': 'Failed to generate content from AI. Please try a different prompt.'}), 500

    image_url = search_pexels_image(title.split(':')[0].strip())

    return jsonify({
        'title': title,
        'content': content,
        'image_url': image_url
    })

# --------------------- NEW: Statistics and Premium Routes --------------------- #

@app.route('/api/stats', methods=['GET'])
def get_global_stats():
    total_users = User.query.count()
    total_posts = Post.query.count()
    total_views = db.session.query(db.func.sum(Post.views)).scalar() or 0 # .scalar() gets single result, or 0 if None
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
        session.clear() # Clear invalid session
        return jsonify({'error': 'User not found'}), 404

    user_posts_count = Post.query.filter_by(user_id=user_id).count()
    user_total_views = db.session.query(db.func.sum(Post.views)).filter_by(user_id=user_id).scalar() or 0
    
    return jsonify({
        'username': user.username,
        'is_premium': user.is_premium,
        'posts_count': user_posts_count,
        'total_views_on_posts': user_total_views
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

    # Construct checkout URL
    # FastSpring allows passing customer details to pre-fill the checkout
    # We use 'tags' to pass the user_id, which can be retrieved in the webhook
    # For actual email, replace 'example.com' with logic to get user's real email if available
    checkout_url = (
        f"https://{FASTSPRING_STORE_SUBDOMAIN}.onfastspring.com/{FASTSPRING_PRODUCT_PATH}?"
        f"customer[email]={user.username}@example.com&" # Placeholder email
        f"tags=user_id_{user_id}&" # Important for linking back in webhook
        f"referrer={request.url_root}" # Where the request originated from
        # Add more params like 'return', 'error' URLs if needed
    )
    return jsonify({'checkout_url': checkout_url})

@app.route('/api/fastspring/webhook', methods=['POST'])
def fastspring_webhook_handler():
    # This is a simplified webhook handler.
    # In a real application, you'd:
    # 1. Verify the webhook signature using FASTSPRING_WEBHOOK_SECRET for security.
    #    (This requires processing raw request body and header, not just request.json)
    # 2. Iterate through data['events'] to process each event.
    # 3. For 'order.completed' or 'subscription.activated' events:
    #    a. Extract the user_id from the 'tags' or 'customer' info.
    #    b. Update the corresponding user's `is_premium` status in your database.
    
    data = request.json
    print(f"FastSpring Webhook Received: {data}")
    
    # Example (DO NOT USE IN PRODUCTION without signature verification):
    # For a completed order, find the user_id in tags and set is_premium to True
    # for event in data.get('events', []):
    #     if event.get('type') == 'order.completed':
    #         customer_id = event['data']['customer']['id']
    #         # Assuming you passed user_id in tags like 'user_id_123'
    #         tags = event['data']['tags']
    #         user_id_from_tag = None
    #         for tag in tags:
    #             if tag.startswith('user_id_'):
    #                 user_id_from_tag = int(tag.split('_')[1])
    #                 break
    #         if user_id_from_tag:
    #             user = User.query.get(user_id_from_tag)
    #             if user:
    #                 user.is_premium = True
    #                 db.session.commit()
    #                 print(f"User {user.username} (ID: {user.id}) marked as premium.")

    return jsonify({'status': 'success'}), 200 # Always return 200 for webhooks to acknowledge receipt


# --------------------- Run App --------------------- #

def create_tables():
    with app.app_context():
        # IMPORTANT: If you had an old blog.db and are adding new columns (like 'is_premium'),
        # you MUST delete 'instance/blog.db' before running this, or uncomment db.drop_all()
        # for one run to re-create the database with the updated schema.
        # This will delete ALL existing users and posts!
        # db.drop_all() # Uncomment this line temporarily to reset your database schema
        db.create_all()

if __name__ == '__main__':
    create_tables()
    app.run(debug=True)