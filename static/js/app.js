// Updated app.js with improved error handling, AI generation (free tier enforcement), User Post Management, Search, Author Pages, Views, Social Sharing, Themes, Statistics, and Landing Page

const AppState = {
    user: null, // Now includes: id, username, is_premium, ai_posts_generated_count, free_tier_ai_limit
    posts: [],
    myPosts: [],
    globalStats: {},
    trendingAiPosts: [],
    currentView: 'landingPage',
    currentUserId: null,
    currentTheme: localStorage.getItem('theme') || 'light',
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
            // Special handling for user data updates from auth, or post creation
            if (url.startsWith('/api/login') || url.startsWith('/api/signup') || url.startsWith('/api/me')) {
                AppState.user = data; // Data IS the user object
            } else if (url === '/api/posts' && method === 'POST' && data.user) {
                AppState.user = { ...AppState.user, ...data.user }; // Merge specific user data returned
            }
            // Ensure free_tier_ai_limit is always present for UI checks from user object
            // This fallback is mostly for old session cookies on first load if they didn't have the field.
            if (AppState.user && AppState.user.free_tier_ai_limit === undefined) {
                const updatedUser = await apiCall('/api/me'); // Re-fetch full user object
                AppState.user = updatedUser || null;
            }
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

    const themeButton = `
        <li class="nav-item ms-lg-3">
            <button class="btn btn-sm btn-outline-light" onclick="toggleTheme()">
                <i class="fas fa-moon d-none dark-icon"></i>
                <i class="fas fa-sun d-none light-icon"></i>
                Toggle Theme
            </button>
        </li>
    `;

    // Always show All Posts/Home link
    navLinks.innerHTML += `<li class="nav-item"><a class="nav-link clickable" onclick="renderPostsList()">All Posts</a></li>`;

    if (AppState.user) {
        navLinks.innerHTML += `
            <li class="nav-item"><a class="nav-link clickable" onclick="renderCreatePostForm()">New Post</a></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="renderMyPostsList()">My Posts</a></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="renderUserDashboard()">Dashboard</a></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="renderPremiumInfoPage()">Premium</a></li>
        `;
        authLinks.innerHTML = `
            ${themeButton}
            <li class="nav-item"><span class="nav-link">Hi, ${AppState.user.username} ${AppState.user.is_premium ? '<span class="badge bg-warning text-dark ms-1">Premium</span>' : ''}</span></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="logout()">Logout</a></li>
        `;
    } else {
        authLinks.innerHTML = `
            ${themeButton}
            <li class="nav-item"><a class="nav-link clickable" onclick="renderLoginForm()">Login</a></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="renderSignupForm()">Signup</a></li>
            <li class="nav-item"><a class="nav-link clickable" onclick="renderPremiumInfoPage()">Premium</a></li>
        `;
    }
    updateThemeIcons();
}

function toggleTheme() {
    AppState.currentTheme = AppState.currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', AppState.currentTheme);
    applyTheme();
    updateThemeIcons();
}

function applyTheme() {
    document.documentElement.setAttribute('data-bs-theme', AppState.currentTheme);
    const navbar = document.getElementById('main-navbar');
    if (AppState.currentTheme === 'dark') {
        navbar.classList.remove('navbar-light', 'bg-light');
        navbar.classList.add('navbar-dark', 'bg-dark');
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
        const [posts, globalStats] = await Promise.all([
            apiCall(`/api/posts${query ? `?query=${encodeURIComponent(query)}` : ''}`),
            apiCall('/api/stats')
        ]);
        AppState.posts = posts;
        AppState.globalStats = globalStats;

        const container = document.getElementById('app');
        container.innerHTML = `
            <h2 class="mb-4">${query ? `Search Results for "${query}"` : 'All Blog Posts'}</h2>
            <div class="input-group mb-4">
                <input type="text" id="search-input" class="form-control" placeholder="Search posts by title or content..." value="${query}">
                <button class="btn btn-outline-secondary" type="button" onclick="searchPosts()">Search</button>
                ${query ? '<button class="btn btn-outline-danger" type="button" onclick="renderPostsList()">Clear Search</button>' : ''}
            </div>

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
                                <h5 class="card-title">${post.title} ${post.is_ai_generated ? '<span class="badge bg-primary ms-1">AI</span>' : ''}</h5>
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

        const postUrl = window.location.origin;
        const shareText = encodeURIComponent(post.title);
        const shareBody = encodeURIComponent(`${post.title}\n\nRead more at: ${postUrl}`);

        container.innerHTML = `
            <div class="card">
                ${post.image_url ? `<img src="${post.image_url}" class="card-img-top post-img">` : ''}
                <div class="card-body">
                    <h3>${post.title} ${post.is_ai_generated ? '<span class="badge bg-primary ms-2">AI Generated</span>' : ''}</h3>
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
    const feedback = document.getElementById('copy-feedback');
    if (!navigator.clipboard) {
        // Fallback for older browsers
        const dummy = document.createElement('textarea');
        document.body.appendChild(dummy);
        dummy.value = window.location.origin;
        dummy.select();
        document.execCommand('copy');
        document.body.removeChild(dummy);
        feedback.textContent = 'Link copied!';
        feedback.style.display = 'block';
        setTimeout(() => feedback.style.display = 'none', 2000);
        return;
    }
    navigator.clipboard.writeText(window.location.origin).then(() => {
        feedback.textContent = 'Link copied!';
        feedback.style.display = 'block';
        setTimeout(() => {
            feedback.style.display = 'none';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
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

function renderLoginForm() {
    document.getElementById('app').innerHTML = `
        <div class="form-container">
            <h3>Login</h3>
            <input id="login-username" class="form-control mb-2" placeholder="Username">
            <input id="login-password" type="password" class="form-control mb-2" placeholder="Password">
            <button class="btn btn-primary" onclick="login()">Login</button>
            <button class="btn btn-secondary ms-2" onclick="renderLandingPage()">Cancel</button>
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
            <button class="btn btn-secondary ms-2" onclick="renderLandingPage()">Cancel</button>
        </div>
    `;
}

async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
        const res = await apiCall('/api/login', 'POST', { username, password });
        // AppState.user is updated in apiCall hook
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
        // AppState.user is updated in apiCall hook
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
        renderLandingPage();
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

    let aiButtonOrMessage = '';
    if (AppState.user) {
        // Ensure free_tier_ai_limit is available, default to 3 if not yet loaded (e.g., old session)
        const freeTierLimit = AppState.user.free_tier_ai_limit !== undefined ? AppState.user.free_tier_ai_limit : 3;
        const aiPostsCount = AppState.user.ai_posts_generated_count !== undefined ? AppState.user.ai_posts_generated_count : 0;

        if (AppState.user.is_premium) {
            aiButtonOrMessage = `<button class="btn btn-info mb-3" onclick="renderAIGenerateForm()">Generate with AI (Unlimited)</button>`;
        } else {
            const remaining = freeTierLimit - aiPostsCount;
            if (remaining > 0) {
                aiButtonOrMessage = `<button class="btn btn-info mb-3" onclick="renderAIGenerateForm()">Generate with AI (${remaining} posts remaining)</button>`;
            } else {
                aiButtonOrMessage = `<p class="text-muted">AI generation limit reached (${freeTierLimit} posts). <a href="#" onclick="renderPremiumInfoPage()">Upgrade to premium</a> for unlimited AI posts.</p>`;
            }
        }
    } else {
         aiButtonOrMessage = `<p class="text-muted">Login to generate posts with AI (3 free posts!).</p>`;
    }


    document.getElementById('app').innerHTML = `
        <div class="form-container">
            <h3>New Blog Post</h3>
            ${aiButtonOrMessage}
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

    const is_ai_generated = aiGeneratedDraft.title ? true : false;

    try {
        const response = await apiCall('/api/posts', 'POST', { title, content, image_url, is_ai_generated });
        // AppState.user is updated by apiCall hook for `data.user`
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

    // Ensure AppState.user and its properties are available
    // Default to 0/3 if properties are undefined (e.g., from an old session cookie)
    const freeTierLimit = AppState.user.free_tier_ai_limit !== undefined ? AppState.user.free_tier_ai_limit : 3;
    const aiPostsCount = AppState.user.ai_posts_generated_count !== undefined ? AppState.user.ai_posts_generated_count : 0;

    // Check premium status OR free tier limit from latest AppState.user
    if (!AppState.user || (!AppState.user.is_premium && aiPostsCount >= freeTierLimit)) {
        alert("AI post generation limit reached. Please upgrade your account to premium for unlimited access.");
        renderUserDashboard(); // Redirect to dashboard if limit reached
        return;
    }

    const remaining = AppState.user.is_premium ? 'Unlimited' : `${freeTierLimit - aiPostsCount} remaining`;

    document.getElementById('app').innerHTML = `
        <div class="form-container">
            <h3>Generate Blog Post with AI</h3>
            <p class="text-muted">You have ${remaining} AI posts available.</p>
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
            // Error is handled by apiCall, but return to form
            // Special handling for "limit reached" error message
            if (response.error.includes('limit reached')) {
                 document.getElementById('app').innerHTML = `
                    <div class="form-container">
                        <p class="text-danger text-center">AI post generation limit reached. Please <a href="#" onclick="renderPremiumInfoPage()">upgrade to premium</a>.</p>
                        <button class="btn btn-secondary mt-3" onclick="renderCreatePostForm()">Manual Post</button>
                    </div>
                `;
            } else {
                renderAIGenerateForm(); // For other types of AI generation errors
            }
            return;
        }

        aiGeneratedDraft = {
            title: response.title,
            content: response.content,
            image_url: response.image_url,
            is_ai_generated: true
        };
        renderCreatePostForm();

    } catch (error) {
        console.error("AI Post Generation failed:", error);
        // This catch block handles network errors or errors not returning JSON.
        // The `apiCall` function will already show a generic alert.
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
                                <h5 class="card-title">${post.title} ${post.is_ai_generated ? '<span class="badge bg-primary ms-1">AI</span>' : ''}</h5>
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
                                <h5 class="card-title">${post.title} ${post.is_ai_generated ? '<span class="badge bg-primary ms-1">AI</span>' : ''}</h5>
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


// ---------------------- USER DASHBOARD / SETTINGS ---------------------- //

async function renderUserDashboard() {
    AppState.currentView = 'userDashboard';
    renderLoading();
    try {
        const userStats = await apiCall('/api/me/stats');
        AppState.user = { ...AppState.user, ...userStats }; // Update AppState.user with latest stats/premium status

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
                                    <button class="btn btn-success mt-2" onclick="renderPremiumInfoPage()">Go Premium!</button>
                                    <p class="mt-2 text-muted small">AI Posts Used: ${AppState.user.ai_posts_generated_count || 0} / ${AppState.user.free_tier_ai_limit || 0}</p>
                                    <p class="mt-2 text-muted small">Unlock unlimited AI generation, advanced features, and more.</p>
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
        updateThemeIcons();
        document.getElementById('current-theme-text').textContent = AppState.currentTheme === 'light' ? 'Light' : 'Dark';

    } catch (error) {
        console.error("Failed to render user dashboard:", error);
        if (error.message && error.message.includes('Unauthorized')) {
             alert('Please log in to view your dashboard.');
             renderLoginForm();
        } else {
            document.getElementById('app').innerHTML = `<p class="text-danger text-center">Failed to load dashboard. Please try again.</p>`;
        }
    }
}

async function goPremium() {
    try {
        const response = await apiCall('/api/fastspring/checkout', 'POST');
        if (response.checkout_url) {
            window.open(response.checkout_url, '_blank');
            alert("Redirecting to FastSpring checkout. Please complete your purchase there. Your premium status will update automatically upon successful payment.");
        } else {
            alert("Failed to get checkout URL. Please try again.");
        }
    } catch (error) {
        console.error("Go Premium failed:", error);
        alert("Failed to start premium checkout. " + error.message);
    }
}

// ---------------------- Premium Information Page ---------------------- //

function renderPremiumInfoPage() {
    AppState.currentView = 'premiumInfo';
    const container = document.getElementById('app');
    container.innerHTML = `
        <div class="form-container text-center">
            <h2 class="mb-4">Go Premium with AI Blogify!</h2>
            <p class="lead">Unlock the full potential of AI content generation and exclusive features.</p>

            <div class="row justify-content-center mt-5">
                <div class="col-md-8">
                    <div class="card text-center bg-info text-white">
                        <div class="card-header">
                            <h3>Premium Plan</h3>
                        </div>
                        <div class="card-body">
                            <h1 class="card-title pricing-card-title">$9.99<small class="text-muted">/month</small></h1>
                            <ul class="list-unstyled mt-3 mb-4">
                                <li><strong>Unlimited</strong> AI Post Generation</li>
                                <li>Access to all future premium features</li>
                                <li>Priority Support</li>
                                <li>Ad-Free Experience (Future)</li>
                                <li>Advanced Analytics (Future)</li>
                            </ul>
                            ${AppState.user ? (AppState.user.is_premium ? 
                                `<button class="btn btn-lg btn-secondary" disabled>You are already Premium!</button>` :
                                `<button class="btn btn-lg btn-success" onclick="goPremium()">Upgrade Now!</button>`) :
                                `<button class="btn btn-lg btn-success" onclick="renderSignupForm()">Sign Up & Go Premium!</button>`
                            }
                        </div>
                    </div>
                </div>
            </div>

            <p class="mt-5 text-muted">For a limited time, enjoy ${AppState.user ? AppState.user.free_tier_ai_limit || 0 : '3'} AI-generated posts on our free tier. Upgrade for endless possibilities!</p>
            <button class="btn btn-secondary mt-4" onclick="renderPostsList()">← Back to All Posts</button>
        </div>
    `;
}


// ---------------------- Landing Page ---------------------- //

async function renderLandingPage() {
    AppState.currentView = 'landingPage';
    renderLoading();
    try {
        const [globalStats, trendingAiPosts] = await Promise.all([
            apiCall('/api/stats'),
            apiCall('/api/trending_ai_posts')
        ]);
        AppState.globalStats = globalStats;
        AppState.trendingAiPosts = trendingAiPosts;

        const container = document.getElementById('app');
        container.innerHTML = `
            <!-- Hero Section -->
            <div class="hero-section mb-5">
                <div class="container">
                    <h1>AI Blogify: Your Daily Dose of AI-Generated Insights</h1>
                    <p class="lead">Harness the power of AI to explore trending topics, get concise summaries, and dive deep into various categories. Fresh content, every day!</p>
                    ${AppState.user ? `
                        <button class="btn btn-primary btn-lg me-3" onclick="renderPostsList()">View All Posts</button>
                        <button class="btn btn-outline-light btn-lg" onclick="renderCreatePostForm()">Create Your Own</button>
                    ` : `
                        <button class="btn btn-primary btn-lg me-3" onclick="renderSignupForm()">Get Started - It's Free!</button>
                        <button class="btn btn-outline-light btn-lg" onclick="renderLoginForm()">Login</button>
                    `}
                </div>
            </div>

            <!-- Global Stats Section -->
            <div class="container my-5 text-center">
                <h2>Our Impact</h2>
                <div class="row justify-content-center mt-4">
                    <div class="col-md-4">
                        <div class="card bg-info text-white p-3">
                            <div class="card-body">
                                <h3 class="card-title">${AppState.globalStats.total_users || 0}</h3>
                                <p class="card-text">Total Users</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="card bg-success text-white p-3">
                            <div class="card-body">
                                <h3 class="card-title">${AppState.globalStats.total_posts || 0}</h3>
                                <p class="card-text">Total Posts Generated</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="card bg-warning text-dark p-3">
                            <div class="card-body">
                                <h3 class="card-title">${AppState.globalStats.total_views || 0}</h3>
                                <p class="card-text">Total Views Across Blog</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Latest Trending AI Posts Section -->
            <div class="container my-5">
                <h2 class="text-center mb-4">Latest Trending AI Posts</h2>
                ${AppState.trendingAiPosts.length === 0 ? `<p class="text-center">No AI-generated posts available yet. Check back soon!</p>` : ''}
                <div class="row">
                    ${AppState.trendingAiPosts.map(post => `
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
                <div class="text-center mt-4">
                    <button class="btn btn-lg btn-secondary" onclick="renderPostsList()">Explore All Blog Posts →</button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error("Failed to render landing page:", error);
    }
}


// ---------------------- INITIALIZATION ---------------------- //

async function initializeApp() {
    applyTheme();
    renderLoading();
    try {
        const user = await apiCall('/api/me');
        renderNavbar();
        await renderLandingPage();
    } catch (error) {
        console.error("Initialization failed:", error);
        renderNavbar();
        await renderLandingPage();
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);