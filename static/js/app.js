// Updated app.js with improved error handling, AI generation, User Post Management, Search, Author Pages, Views, Social Sharing, Themes, and Statistics

const AppState = {
    user: null,
    posts: [],
    myPosts: [],
    globalStats: {}, // NEW: For global blog statistics
    currentView: 'allPosts', // 'allPosts', 'myPosts', 'userPosts', 'singlePost', 'createPost', 'aiGenerate', 'userDashboard'
    currentUserId: null,
    currentTheme: localStorage.getItem('theme') || 'light', // NEW: Store/Load theme preference
};

// Utility function to make API calls with error handling
async function apiCall(url, method = 'GET', body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);

    try {
        const res = await fetch(url, options);
        const contentType = res.headers.get('content-type');

        if (!contentType || !contentType.includes('application/json')) {
            const text = await res.text();
            console.error('Non-JSON response:', text);
            alert(`Unexpected server response. Status: ${res.status}. Check console for details.`);
            throw new Error(`Unexpected response from ${url}`);
        }

        const data = await res.json();
        if (res.ok) {
            return data;
        } else {
            const errorMessage = data.error || 'An unknown error occurred.';
            alert(`Error: ${errorMessage}`);
            throw new Error(errorMessage);
        }
    } catch (err) {
        console.error('API call failed:', err);
        if (!document.getElementById('app').querySelector('.alert-danger')) {
            document.getElementById('app').innerHTML = `<p class="text-danger text-center">Failed to load content or perform action. Check console for details.</p>`;
        }
        throw err;
    }
}

// ---------------------- UI RENDER FUNCTIONS ---------------------- //

function renderLoading() {
    document.getElementById('app').innerHTML = `
        <div class="text-center spinner-container">
            <div class="spinner-border" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p>Loading Content...</p>
        </div>
    `;
}

function renderNavbar() {
    const navLinks = document.getElementById('nav-links');
    const authLinks = document.getElementById('auth-links');
    navLinks.innerHTML = '';
    authLinks.innerHTML = '';

    // Theme Toggle Button
    const themeButton = `
        <li class="nav-item ms-lg-3">
            <button class="btn btn-sm btn-outline-light" onclick="toggleTheme()">
                <i class="fas fa-moon d-none dark-icon"></i>
                <i class="fas fa-sun d-none light-icon"></i>
                Toggle Theme
            </button>
        </li>
    `;

    if (AppState.user) {
        navLinks.innerHTML = `
            <li class="nav-item"><a class="nav-link clickable" onclick="renderCreatePostForm()">New Post</a></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="renderMyPostsList()">My Posts</a></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="renderUserDashboard()">Dashboard</a></li> <!-- NEW Dashboard Link -->
        `;
        authLinks.innerHTML = `
            ${themeButton}
            <li class="nav-item"><span class="nav-link">Hi, ${AppState.user.username} ${AppState.user.is_premium ? '<span class="badge bg-warning text-dark ms-1">Premium</span>' : ''}</span></li> <!-- Display Premium Status -->
            <li class="nav-item"><a class="nav-link clickable" onclick="logout()">Logout</a></li>
        `;
    } else {
        authLinks.innerHTML = `
            ${themeButton}
            <li class="nav-item"><a class="nav-link clickable" onclick="renderLoginForm()">Login</a></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="renderSignupForm()">Signup</a></li>
        `;
    }
    updateThemeIcons(); // Update icons after rendering navbar
}

// NEW: Theme Toggle Logic
function toggleTheme() {
    AppState.currentTheme = AppState.currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', AppState.currentTheme);
    applyTheme();
    updateThemeIcons();
}

function applyTheme() {
    document.documentElement.setAttribute('data-bs-theme', AppState.currentTheme);
    // Adjust navbar background for dark mode if needed, or rely on Bootstrap's data-bs-theme
    const navbar = document.getElementById('main-navbar');
    if (AppState.currentTheme === 'dark') {
        navbar.classList.remove('navbar-dark', 'bg-dark');
        navbar.classList.add('navbar-dark', 'bg-dark'); // Re-add dark if still default, or add bg-dark for better contrast
        // If you want actual light navbar in light mode, and dark in dark:
        // navbar.classList.remove('bg-dark', 'bg-light');
        // navbar.classList.add(AppState.currentTheme === 'dark' ? 'bg-dark' : 'bg-light');
    } else {
         navbar.classList.remove('navbar-dark', 'bg-dark');
         navbar.classList.add('navbar-light', 'bg-light');
    }
}

function updateThemeIcons() {
    const lightIcon = document.querySelector('.light-icon');
    const darkIcon = document.querySelector('.dark-icon');
    if (lightIcon && darkIcon) {
        if (AppState.currentTheme === 'light') {
            lightIcon.classList.remove('d-none');
            darkIcon.classList.add('d-none');
        } else {
            lightIcon.classList.add('d-none');
            darkIcon.classList.remove('d-none');
        }
    }
}


async function renderPostsList(query = '') {
    AppState.currentView = 'allPosts';
    AppState.currentUserId = null;
    renderLoading();
    try {
        // Fetch global stats as well
        const [posts, globalStats] = await Promise.all([
            apiCall(`/api/posts${query ? `?query=${encodeURIComponent(query)}` : ''}`),
            apiCall('/api/stats')
        ]);
        AppState.posts = posts;
        AppState.globalStats = globalStats; // Update global state

        const container = document.getElementById('app');
        container.innerHTML = `
            <h2 class="mb-4">${query ? `Search Results for "${query}"` : 'All Blog Posts'}</h2>
            <div class="input-group mb-4">
                <input type="text" id="search-input" class="form-control" placeholder="Search posts by title or content..." value="${query}">
                <button class="btn btn-outline-secondary" type="button" onclick="searchPosts()">Search</button>
                ${query ? '<button class="btn btn-outline-danger" type="button" onclick="renderPostsList()">Clear Search</button>' : ''}
            </div>

            <!-- Global Stats Display (NEW) -->
            <div class="alert alert-info text-center">
                <strong>Blog Stats:</strong> Total Users: ${AppState.globalStats.total_users || 0} | Total Posts: ${AppState.globalStats.total_posts || 0} | Total Views: ${AppState.globalStats.total_views || 0}
            </div>

            ${posts.length === 0 ? `<p class="text-center">No posts found.${query ? ' Try a different search term.' : ''}</p>` : ''}

            <div class="row">
                ${posts.map(post => `
                    <div class="col-md-4 mb-4">
                        <div class="card post-card">
                            ${post.image_url ? `<img src="${post.image_url}" class="card-img-top post-img">` : ''}
                            <div class="card-body">
                                <h5 class="card-title">${post.title}</h5>
                                <p class="card-text">${post.content.replace(/<[^>]*>?/gm, '').slice(0, 100)}...</p>
                                <p class="card-text text-muted small">
                                    By: <a class="clickable" onclick="renderUserPosts(${post.user_id})">${post.username}</a>
                                    <span class="ms-2">Views: ${post.views || 0}</span>
                                </p>
                                <a class="btn btn-sm btn-outline-primary" onclick="renderSinglePost(${post.id})">Read More</a>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error("Failed to render post list:", error);
    }
}

function searchPosts() {
    const query = document.getElementById('search-input').value;
    renderPostsList(query);
}


async function renderSinglePost(id) {
    AppState.currentView = 'singlePost';
    renderLoading();
    try {
        const post = await apiCall(`/api/posts/${id}`);
        const container = document.getElementById('app');

        const postUrl = window.location.origin; // Current base URL of the SPA
        const shareText = encodeURIComponent(post.title);
        const shareBody = encodeURIComponent(`${post.title}\n\nRead more at: ${postUrl}`);

        container.innerHTML = `
            <div class="card">
                ${post.image_url ? `<img src="${post.image_url}" class="card-img-top post-img">` : ''}
                <div class="card-body">
                    <h3>${post.title}</h3>
                    <p class="text-muted small">
                        By: <a class="clickable" onclick="renderUserPosts(${post.user_id})">${post.username}</a>
                        <span class="ms-2">Views: ${post.views || 0}</span>
                    </p>
                    <div class="post-content-html">${post.content}</div>

                    <hr>

                    <div class="share-section my-3">
                        <h5>Share this post:</h5>
                        <button class="btn btn-sm btn-info me-2 mb-2" onclick="copyPostLink()">Copy Link</button>
                        <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}" target="_blank" class="btn btn-sm btn-primary me-2 mb-2">
                            <i class="fab fa-facebook-f"></i> Facebook
                        </a>
                        <a href="https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(postUrl)}" target="_blank" class="btn btn-sm btn-dark me-2 mb-2">
                            <i class="fab fa-twitter"></i> Twitter
                        </a>
                        <a href="https://wa.me/?text=${shareText}%20${encodeURIComponent(postUrl)}" target="_blank" class="btn btn-sm btn-success me-2 mb-2">
                            <i class="fab fa-whatsapp"></i> WhatsApp
                        </a>
                        <a href="https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(postUrl)}&title=${shareText}&summary=${encodeURIComponent(post.content.slice(0, 200))}" target="_blank" class="btn btn-sm btn-primary me-2 mb-2">
                            <i class="fab fa-linkedin-in"></i> LinkedIn
                        </a>
                        <a href="https://mail.google.com/mail/?view=cm&fs=1&su=${shareText}&body=${shareBody}" target="_blank" class="btn btn-sm btn-danger me-2 mb-2">
                            <i class="fas fa-envelope"></i> Gmail
                        </a>
                    </div>
                    <p id="copy-feedback" class="text-success" style="display:none;"></p>

                    <div class="mt-3">
                        <button class="btn btn-secondary me-2" onclick="renderPostsList()">← Back to All Posts</button>
                        ${AppState.user && AppState.user.id === post.user_id ? `
                            <button class="btn btn-warning me-2" onclick="renderEditPostForm(${post.id})">Edit</button>
                            <button class="btn btn-danger" onclick="deletePost(${post.id})">Delete</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error("Failed to render single post:", error);
    }
}

function copyPostLink() {
    const postUrl = window.location.origin;
    navigator.clipboard.writeText(postUrl).then(() => {
        const feedback = document.getElementById('copy-feedback');
        feedback.textContent = 'Link copied!';
        feedback.style.display = 'block';
        setTimeout(() => {
            feedback.style.display = 'none';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        const feedback = document.getElementById('copy-feedback');
        feedback.textContent = 'Failed to copy link!';
        feedback.style.color = 'red';
        feedback.style.display = 'block';
        setTimeout(() => {
            feedback.style.display = 'none';
            feedback.style.color = '';
        }, 2000);
    });
}


// ---------------------- AUTH FORMS ---------------------- //
// ... (Auth forms remain the same) ...

function renderLoginForm() {
    document.getElementById('app').innerHTML = `
        <div class="form-container">
            <h3>Login</h3>
            <input id="login-username" class="form-control mb-2" placeholder="Username">
            <input id="login-password" type="password" class="form-control mb-2" placeholder="Password">
            <button class="btn btn-primary" onclick="login()">Login</button>
            <button class="btn btn-secondary ms-2" onclick="renderPostsList()">Cancel</button>
        </div>
    `;
}

function renderSignupForm() {
    document.getElementById('app').innerHTML = `
        <div class="form-container">
            <h3>Signup</h3>
            <input id="signup-username" class="form-control mb-2" placeholder="Username">
            <input id="signup-password" type="password" class="form-control mb-2" placeholder="Password">
            <button class="btn btn-success" onclick="signup()">Create Account</button>
            <button class="btn btn-secondary ms-2" onclick="renderPostsList()">Cancel</button>
        </div>
    `;
}

async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
        const res = await apiCall('/api/login', 'POST', { username, password });
        AppState.user = res;
        renderNavbar();
        renderPostsList();
    } catch (error) {
        console.error("Login failed:", error);
    }
}

async function signup() {
    const username = document.getElementById('signup-username').value;
    const password = document.getElementById('signup-password').value;
    try {
        const res = await apiCall('/api/signup', 'POST', { username, password });
        AppState.user = res;
        renderNavbar();
        renderPostsList();
    } catch (error) {
        console.error("Signup failed:", error);
    }
}

async function logout() {
    try {
        await apiCall('/api/logout');
        AppState.user = null;
        renderNavbar();
        renderPostsList();
    } catch (error) {
        console.error("Logout failed:", error);
    }
}


// ---------------------- CREATE / EDIT POST ---------------------- //

let aiGeneratedDraft = {};

function destroyTinymce() {
    const editor = tinymce.get("post-content");
    if (editor) {
        editor.destroy();
    }
}

function renderCreatePostForm() {
    AppState.currentView = 'createPost';
    destroyTinymce();

    document.getElementById('app').innerHTML = `
        <div class="form-container">
            <h3>New Blog Post</h3>
            ${AppState.user && AppState.user.is_premium ? `<button class="btn btn-info mb-3" onclick="renderAIGenerateForm()">Generate with AI</button>` : AppState.user ? '<p class="text-muted">AI generation is a <a href="#" onclick="renderUserDashboard()">premium feature</a>.</p>' : ''} <!-- Premium Check -->
            <input id="post-title" class="form-control mb-2" placeholder="Post Title" value="${aiGeneratedDraft.title || ''}">
            <input id="post-image" class="form-control mb-2" placeholder="Image URL (optional)" value="${aiGeneratedDraft.image_url || ''}">
            <textarea id="post-content" class="form-control mb-2" rows="8" placeholder="Write your content here..."></textarea>
            <button class="btn btn-primary" onclick="createPost()">Publish</button>
            <button class="btn btn-secondary ms-2" onclick="renderPostsList()">Cancel</button>
        </div>
    `;

    const initialContent = aiGeneratedDraft.content || '';
    tinymce.init({
        selector: '#post-content',
        menubar: false,
        plugins: 'lists link image code',
        toolbar: 'undo redo | bold italic | alignleft aligncenter alignright | bullist numlist | code',
        readonly: false,
        setup: function(editor) {
            editor.on('init', function() {
                if (initialContent) {
                    editor.setContent(initialContent);
                    editor.undoManager.clear();
                    editor.setDirty(false);
                }
            });
        }
    });
    aiGeneratedDraft = {};
}

async function renderEditPostForm(postId) {
    AppState.currentView = 'editPost';
    renderLoading();
    destroyTinymce();

    try {
        const postToEdit = await apiCall(`/api/posts/${postId}`);
        if (!postToEdit) {
            alert("Post not found for editing.");
            renderMyPostsList();
            return;
        }
        if (!AppState.user || AppState.user.id !== postToEdit.user_id) {
            alert("You are not authorized to edit this post.");
            renderMyPostsList();
            return;
        }

        document.getElementById('app').innerHTML = `
            <div class="form-container">
                <h3>Edit Blog Post</h3>
                <input id="post-title" class="form-control mb-2" placeholder="Post Title" value="${postToEdit.title || ''}">
                <input id="post-image" class="form-control mb-2" placeholder="Image URL (optional)" value="${postToEdit.image_url || ''}">
                <textarea id="post-content" class="form-control mb-2" rows="8" placeholder="Write your content here..."></textarea>
                <button class="btn btn-primary" onclick="updatePost(${postId})">Update</button>
                <button class="btn btn-secondary ms-2" onclick="renderMyPostsList()">Cancel</button>
            </div>
        `;

        const initialContent = postToEdit.content || '';
        tinymce.init({
            selector: '#post-content',
            menubar: false,
            plugins: 'lists link image code',
            toolbar: 'undo redo | bold italic | alignleft aligncenter alignright | bullist numlist | code',
            readonly: false,
            setup: function(editor) {
                editor.on('init', function() {
                    if (initialContent) {
                        editor.setContent(initialContent);
                        editor.undoManager.clear();
                        editor.setDirty(false);
                    }
                });
            }
        });

    } catch (error) {
        console.error("Failed to render edit form:", error);
    }
}

async function createPost() {
    const title = document.getElementById('post-title').value;
    const image_url = document.getElementById('post-image').value;
    let content = '';
    const editor = tinymce.get("post-content");

    if (editor) {
        content = editor.getContent();
    } else {
        console.warn("TinyMCE editor instance not found. Falling back to textarea value.");
        content = document.getElementById('post-content').value;
    }

    if (!title.trim() || !content.trim()) {
        alert("Title and content cannot be empty.");
        return;
    }

    try {
        await apiCall('/api/posts', 'POST', { title, content, image_url });
        destroyTinymce();
        renderPostsList();
    } catch (error) {
        console.error("Create post failed:", error);
    }
}

async function updatePost(postId) {
    const title = document.getElementById('post-title').value;
    const image_url = document.getElementById('post-image').value;
    let content = '';
    const editor = tinymce.get("post-content");

    if (editor) {
        content = editor.getContent();
    } else {
        console.warn("TinyMCE editor instance not found during update. Falling back to textarea value.");
        content = document.getElementById('post-content').value;
    }

    if (!title.trim() || !content.trim()) {
        alert("Title and content cannot be empty.");
        return;
    }

    try {
        await apiCall(`/api/posts/${postId}`, 'PUT', { title, content, image_url });
        destroyTinymce();
        renderMyPostsList();
    } catch (error) {
        console.error("Update post failed:", error);
    }
}

async function deletePost(postId) {
    if (confirm("Are you sure you want to delete this post? This cannot be undone.")) {
        try {
            await apiCall(`/api/posts/${postId}`, 'DELETE');
            if (AppState.currentView === 'myPosts' || AppState.currentView === 'singlePost') {
                renderMyPostsList();
            } else {
                renderPostsList();
            }
        } catch (error) {
            console.error("Delete post failed:", error);
        }
    }
}

// ---------------------- AI POST GENERATION UI & LOGIC ---------------------- //

function renderAIGenerateForm() {
    AppState.currentView = 'aiGenerate';
    destroyTinymce();

    // Check premium status before rendering AI form
    if (!AppState.user || !AppState.user.is_premium) {
        alert("AI post generation is a premium feature. Please upgrade your account.");
        renderUserDashboard(); // Redirect to dashboard or premium info page
        return;
    }

    document.getElementById('app').innerHTML = `
        <div class="form-container">
            <h3>Generate Blog Post with AI</h3>
            <p class="text-muted">Enter a brief prompt describing what you want your blog post to be about. E.g., "The benefits of meditation for daily stress relief."</p>
            <textarea id="ai-prompt" class="form-control mb-2" rows="4" placeholder="Enter your prompt here..."></textarea>
            <button class="btn btn-success" onclick="generatePostWithAI()">Generate</button>
            <button class="btn btn-secondary ms-2" onclick="renderCreatePostForm()">Back to New Post</button>
        </div>
    `;
}

async function generatePostWithAI() {
    const prompt = document.getElementById('ai-prompt').value;
    if (!prompt.trim()) {
        alert("Please enter a prompt to generate content.");
        return;
    }

    renderLoading();

    try {
        const response = await apiCall('/api/generate_ai_post', 'POST', { prompt });
        if (response.error) {
            renderAIGenerateForm();
            return;
        }

        aiGeneratedDraft = {
            title: response.title,
            content: response.content,
            image_url: response.image_url
        };
        renderCreatePostForm();

    } catch (error) {
        console.error("AI Post Generation failed:", error);
        document.getElementById('app').innerHTML = `
            <div class="form-container">
                <p class="text-danger text-center">Failed to generate AI content. Please try again or with a different prompt.</p>
                <button class="btn btn-secondary mt-3" onclick="renderAIGenerateForm()">Try Again</button>
                <button class="btn btn-secondary ms-2 mt-3" onclick="renderCreatePostForm()">Manual Post</button>
            </div>
        `;
    }
}

// ---------------------- MY POSTS SECTION ---------------------- //
// ... (My Posts List remains the same) ...

async function renderMyPostsList() {
    AppState.currentView = 'myPosts';
    renderLoading();
    try {
        const myPosts = await apiCall('/api/me/posts');
        AppState.myPosts = myPosts;

        const container = document.getElementById('app');
        if (myPosts.length === 0) {
            container.innerHTML = `
                <div class="form-container text-center">
                    <h3>My Posts</h3>
                    <p>You haven't created any posts yet.</p>
                    <button class="btn btn-primary" onclick="renderCreatePostForm()">Create First Post</button>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <h3>My Posts</h3>
            <div class="row">
                ${myPosts.map(post => `
                    <div class="col-md-6 mb-4">
                        <div class="card post-card">
                            ${post.image_url ? `<img src="${post.image_url}" class="card-img-top post-img">` : ''}
                            <div class="card-body">
                                <h5 class="card-title">${post.title}</h5>
                                <p class="card-text">${post.content.replace(/<[^>]*>?/gm, '').slice(0, 100)}...</p>
                                <p class="card-text text-muted small">By: <a class="clickable" onclick="renderUserPosts(${post.user_id})">${post.username}</a>
                                <span class="ms-2">Views: ${post.views || 0}</span>
                                </p>
                                <div class="mt-3">
                                    <a class="btn btn-sm btn-outline-primary me-2" onclick="renderSinglePost(${post.id})">View</a>
                                    <a class="btn btn-sm btn-warning me-2" onclick="renderEditPostForm(${post.id})">Edit</a>
                                    <a class="btn btn-sm btn-danger" onclick="deletePost(${post.id})">Delete</a>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error("Failed to render user's posts:", error);
    }
}


// ---------------------- USER'S PUBLIC POSTS PAGE ---------------------- //
// ... (User's Public Posts Page remains the same) ...

async function renderUserPosts(userId, query = '') {
    AppState.currentView = 'userPosts';
    AppState.currentUserId = userId;
    renderLoading();

    try {
        const userPosts = await apiCall(`/api/users/${userId}/posts${query ? `?query=${encodeURIComponent(query)}` : ''}`);
        
        const username = userPosts.length > 0 ? userPosts[0].username : 'Unknown User';

        const container = document.getElementById('app');
        container.innerHTML = `
            <h2 class="mb-4">Posts by ${username} ${query ? `(Search Results for "${query}")` : ''}</h2>
            <div class="input-group mb-4">
                <input type="text" id="search-input-user" class="form-control" placeholder="Search posts by ${username}..." value="${query}">
                <button class="btn btn-outline-secondary" type="button" onclick="searchUserPosts(${userId})">Search</button>
                ${query ? `<button class="btn btn-outline-danger" type="button" onclick="renderUserPosts(${userId})">Clear Search</button>` : ''}
            </div>
            <button class="btn btn-secondary mb-4" onclick="renderPostsList()">← Back to All Posts</button>

            ${userPosts.length === 0 ? `<p class="text-center">No posts found for this user.${query ? ' Try a different search term.' : ''}</p>` : ''}

            <div class="row">
                ${userPosts.map(post => `
                    <div class="col-md-4 mb-4">
                        <div class="card post-card">
                            ${post.image_url ? `<img src="${post.image_url}" class="card-img-top post-img">` : ''}
                            <div class="card-body">
                                <h5 class="card-title">${post.title}</h5>
                                <p class="card-text">${post.content.replace(/<[^>]*>?/gm, '').slice(0, 100)}...</p>
                                <p class="card-text text-muted small">By: ${post.username}
                                <span class="ms-2">Views: ${post.views || 0}</span>
                                </p>
                                <a class="btn btn-sm btn-outline-primary" onclick="renderSinglePost(${post.id})">Read More</a>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error("Failed to render user's public posts:", error);
    }
}

function searchUserPosts(userId) {
    const query = document.getElementById('search-input-user').value;
    renderUserPosts(userId, query);
}


// ---------------------- NEW: USER DASHBOARD / SETTINGS ---------------------- //

async function renderUserDashboard() {
    AppState.currentView = 'userDashboard';
    renderLoading();
    try {
        const userStats = await apiCall('/api/me/stats');
        AppState.user = { ...AppState.user, ...userStats }; // Update user object with latest stats/premium status

        const container = document.getElementById('app');
        container.innerHTML = `
            <div class="form-container">
                <h3>Welcome, ${AppState.user.username}!</h3>
                <h4 class="mb-4">Your Dashboard</h4>

                <div class="row mb-4">
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body">
                                <h5 class="card-title">Account Status</h5>
                                <p class="card-text">Status: ${AppState.user.is_premium ? '<span class="badge bg-warning text-dark">Premium</span>' : '<span class="badge bg-secondary">Free</span>'}</p>
                                ${!AppState.user.is_premium ? `
                                    <button class="btn btn-success mt-2" onclick="goPremium()">Go Premium!</button>
                                    <p class="mt-2 text-muted small">Unlock AI generation, advanced features, and more.</p>
                                ` : `
                                    <p class="mt-2 text-muted small">Thank you for being a premium member! Enjoy exclusive features.</p>
                                `}
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body">
                                <h5 class="card-title">Your Content Stats</h5>
                                <p class="card-text">Total Posts: <strong>${userStats.posts_count || 0}</strong></p>
                                <p class="card-text">Total Views on Your Posts: <strong>${userStats.total_views_on_posts || 0}</strong></p>
                            </div>
                        </div>
                    </div>
                </div>

                <hr class="my-4">

                <h4>Account Settings</h4>
                <div class="row">
                    <div class="col-md-6">
                        <p>Username: <strong>${AppState.user.username}</strong></p>
                        <!-- Future: Add options to change username/password here -->
                    </div>
                    <div class="col-md-6">
                        <h5 class="mb-2">Theme Preference:</h5>
                        <button class="btn btn-sm btn-outline-dark" onclick="toggleTheme()">
                            <i class="fas fa-moon d-none dark-icon"></i>
                            <i class="fas fa-sun d-none light-icon"></i>
                            Current: <span id="current-theme-text">${AppState.currentTheme === 'light' ? 'Light' : 'Dark'}</span>
                        </button>
                    </div>
                </div>
                
                <button class="btn btn-secondary mt-4" onclick="renderPostsList()">← Back to Posts</button>
            </div>
        `;
        updateThemeIcons(); // Apply correct icons after rendering dashboard
        document.getElementById('current-theme-text').textContent = AppState.currentTheme === 'light' ? 'Light' : 'Dark';

    } catch (error) {
        console.error("Failed to render user dashboard:", error);
        // If error is unauthorized, redirect to login
        if (error.message && error.message.includes('Unauthorized')) {
             alert('Please log in to view your dashboard.');
             renderLoginForm();
        } else {
            document.getElementById('app').innerHTML = `<p class="text-danger text-center">Failed to load dashboard. Please try again.</p>`;
        }
    }
}

// NEW: Function to initiate premium checkout
async function goPremium() {
    try {
        const response = await apiCall('/api/fastspring/checkout', 'POST');
        if (response.checkout_url) {
            window.open(response.checkout_url, '_blank'); // Open FastSpring checkout in new tab
            alert("Redirecting to FastSpring checkout. Please complete your purchase there.");
            // You might want to periodically check backend or refresh dashboard after some time
            // to see if premium status has updated via webhook.
        } else {
            alert("Failed to get checkout URL. Please try again.");
        }
    } catch (error) {
        console.error("Go Premium failed:", error);
        alert("Failed to start premium checkout. " + error.message);
    }
}


// ---------------------- INITIALIZATION ---------------------- //

async function initializeApp() {
    applyTheme(); // Apply theme preference immediately
    renderLoading();
    try {
        const user = await apiCall('/api/me');
        AppState.user = user;
        renderNavbar();
        await renderPostsList();
    } catch (error) {
        console.error("Initialization failed:", error);
        renderNavbar();
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);