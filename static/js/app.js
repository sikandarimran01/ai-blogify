// static/js/app.js - Advanced AI Content Platform

// --- STATE MANAGEMENT ---
const AppState = { user: null, posts: [] };

// --- DOM ELEMENT REFERENCES ---
const appContainer = document.getElementById('app');
const navLinks = document.getElementById('nav-links');
const authLinks = document.getElementById('auth-links');

// --- API HELPER ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    try {
        const response = await fetch(endpoint, options);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(errorData.message || 'An API error occurred');
        }
        if (response.status === 204 || response.headers.get("content-length") === "0") return null;
        return await response.json();
    } catch (error) {
        console.error(`API Call Error to ${endpoint}:`, error);
        alert(`Error: ${error.message}`);
        return null;
    }
}

// ===================================================================
// --- RENDER FUNCTIONS (THE VIEWS OF OUR APP) ---
// ===================================================================

function renderNavbar() {
    navLinks.innerHTML = ''; authLinks.innerHTML = '';
    if (AppState.user) {
        navLinks.innerHTML = `<li class="nav-item"><a class="nav-link" onclick="renderManualPostForm()">Write Post</a></li><li class="nav-item"><a class="nav-link" onclick="renderAIPostForm()">Generate with AI</a></li>`;
        authLinks.innerHTML = `<li class="nav-item"><a class="nav-link" onclick="renderDashboard()">Dashboard (${AppState.user.username})</a></li><li class="nav-item"><a class="nav-link" onclick="handleLogout()">Logout</a></li>`;
    } else {
        authLinks.innerHTML = `<li class="nav-item"><a class="nav-link" onclick="renderLoginForm()">Login</a></li><li class="nav-item"><a class="nav-link" onclick="renderRegisterForm()">Register</a></li>`;
    }
}

function renderLoading() {
    appContainer.innerHTML = `<div class="spinner-container"><div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div></div>`;
}

async function renderPostsList() {
    renderLoading();
    const posts = await apiCall('/api/posts');
    if (!posts) return;
    AppState.posts = posts;
    let postsHtml = '<h1 class="mb-4">Latest Posts</h1>';
    posts.forEach(post => {
        postsHtml += `<div class="card post-card mb-4"><img src="${post.image_url}" class="card-img-top post-img" alt="${post.title}"><div class="card-body"><h2 class="card-title">${post.title}</h2><p class="card-text"><small class="text-muted">By ${post.author.username} on ${post.date_posted}</small></p><p class="card-text">${post.summary || post.content.substring(0, 200)}...</p><a class="btn btn-primary clickable" onclick="renderSinglePost(${post.id})">Read More</a></div></div>`;
    });
    appContainer.innerHTML = postsHtml;
}

async function renderSinglePost(postId) {
    renderLoading();
    const post = await apiCall(`/api/post/${postId}`);
    if (!post) return;
    appContainer.innerHTML = `
        <button class="btn btn-secondary mb-3" onclick="renderPostsList()">← Back to Posts</button>
        <div class="row">
            <div class="col-lg-8">
                <div class="card mb-4"><div class="card-body">
                    <h1>${post.title}</h1>
                    <img src="${post.image_url}" class="img-fluid rounded my-3" alt="${post.title}">
                    <p class="text-muted">By ${post.author.username} | Category: ${post.category} | Views: ${post.views}</p>
                    <hr>
                    <div class="post-content">${post.content.replace(/\n/g, '<br>')}</div>
                </div></div>
                ${renderCommentsSection(post)}
            </div>
            <div class="col-lg-4">
                ${renderSEOAnalysis(post)}
            </div>
        </div>
    `;
    // Fetch SEO analysis in the background
    handleSEOAnalysis(post.content);
}

// --- NEW/UPDATED: Rich Text Editor & AI Co-Pilot Form ---
function renderManualPostForm() {
    if (!AppState.user) { renderLoginForm(); return; }
    appContainer.innerHTML = `
        <div class="row"><div class="col-md-10 offset-md-1"><div class="form-container">
            <h2>Write a New Post</h2>
            <form id="manual-post-form">
                <input type="hidden" id="image_url" name="image_url" value="">
                <div class="mb-3"><label for="title" class="form-label">Title</label><input type="text" class="form-control" id="title" name="title" required></div>
                <div class="mb-3"><label class="form-label">Featured Image</label>
                    <div class="input-group">
                        <input class="form-control" type="file" id="image-upload" accept="image/png, image/jpeg, image/gif">
                        <button class="btn btn-outline-primary" type="button" id="dalle-btn" onclick="handleGenerateAIImage()">Generate with DALL-E</button>
                    </div>
                    <div id="upload-status" class="form-text">Recommended: 1200x600 pixels</div>
                    <div id="image-preview-container" class="mt-2"></div>
                </div>
                <div class="mb-3"><label for="category" class="form-label">Category</label><input type="text" class="form-control" id="category" name="category" required></div>
                
                <div class="mb-3 p-2 bg-light border rounded">
                    <strong>AI Co-Pilot:</strong>
                    <button type="button" class="btn btn-sm btn-outline-primary" id="ai-continue-btn" onclick="handleAIContinueWriting()">Continue Writing</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="ai-rephrase-btn" onclick="handleAIRephrase()">Rephrase Selected</button>
                    <button type="button" class="btn btn-sm btn-outline-success" id="ai-headline-btn" onclick="handleAISuggestHeadlines()">Suggest Headlines</button>
                </div>
                <div id="content-editor"></div>
                <div id="headline-suggestions" class="mt-3"></div>
                <button type="submit" class="btn btn-primary mt-3">Create Post</button>
            </form>
        </div></div></div>`;

    tinymce.init({
        selector: '#content-editor',
        plugins: 'autolink lists link image charmap preview anchor searchreplace visualblocks code fullscreen insertdatetime media table help wordcount',
        toolbar: 'undo redo | blocks | bold italic | alignleft aligncenter alignright | bullist numlist outdent indent | help',
        height: 500,
    });

    document.getElementById('manual-post-form').addEventListener('submit', handleCreateManualPost);
    document.getElementById('image-upload').addEventListener('change', handleImageUpload);
}


// --- All other render functions (Login, Register, AI Form, Dashboard) are the same as before ---
// ... (paste the code for renderLoginForm, renderRegisterForm, renderAIPostForm, and renderDashboard here) ...

// ===================================================================
// --- NEW RENDER FUNCTIONS FOR ADVANCED FEATURES ---
// ===================================================================

function renderCommentsSection(post) {
    let commentsHtml = post.comments.map(comment => `
        <div class="d-flex mb-3">
            <div class="flex-shrink-0"><img class="rounded-circle" src="https://via.placeholder.com/50" alt="..."></div>
            <div class="ms-3">
                <div class="fw-bold">${comment.author.username}</div>
                ${comment.content}
            </div>
        </div>
    `).join('');

    const commentFormHtml = AppState.user ? `
        <form id="comment-form" class="mt-4">
            <h5>Leave a Comment</h5>
            <textarea name="content" class="form-control" rows="3" required></textarea>
            <button type="submit" class="btn btn-primary mt-2">Submit</button>
        </form>
    ` : '<p class="mt-4">Please <a class="clickable" onclick="renderLoginForm()">log in</a> to leave a comment.</p>';

    return `
        <div class="card mt-4"><div class="card-body">
            <h4 class="card-title">Comments (${post.comment_count})</h4>
            <hr>
            ${commentsHtml}
            ${commentFormHtml}
        </div></div>
    `;
    // Add event listener after rendering
    setTimeout(() => {
        const form = document.getElementById('comment-form');
        if (form) form.addEventListener('submit', (e) => handleCommentSubmit(e, post.id));
    }, 0);
}

function renderSEOAnalysis(post) {
    return `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title">AI SEO Assistant</h5>
                <div id="seo-analysis-content">
                    <div class="spinner-border spinner-border-sm" role="status"></div>
                    <span>Analyzing...</span>
                </div>
            </div>
        </div>
    `;
}

// ===================================================================
// --- EVENT HANDLERS ---
// ===================================================================

async function handleLogin(event) { /* ... same as before ... */ }
async function handleRegister(event) { /* ... same as before ... */ }
async function handleLogout() { /* ... same as before ... */ }
async function handleImageUpload(event) { /* ... same as before ... */ }

async function handleCreateManualPost(event) {
    event.preventDefault();
    const content = tinymce.get('content-editor').getContent();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    data.content = content; // Add editor content to data
    const newPost = await apiCall('/api/post', 'POST', data);
    if (newPost) { alert('Post created successfully!'); renderSinglePost(newPost.id); }
}

async function handleGenerateAIPost(event) { /* ... same as before ... */ }

// --- NEW EVENT HANDLERS FOR ADVANCED FEATURES ---

async function handleCommentSubmit(event, postId) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form).entries());
    const result = await apiCall(`/api/post/${postId}/comment`, 'POST', data);
    if (result) {
        alert(result.message || 'Comment posted successfully!');
        renderSinglePost(postId); // Re-render to show the new comment
    }
}

async function handleGenerateAIImage() {
    const title = document.getElementById('title').value;
    if (!title) { alert('Please enter a title first to use as a prompt for the AI.'); return; }
    const statusDiv = document.getElementById('upload-status');
    const previewContainer = document.getElementById('image-preview-container');
    const imageUrlInput = document.getElementById('image_url');
    const button = document.getElementById('dalle-btn');

    statusDiv.textContent = 'Generating AI image... This may take a moment.';
    button.disabled = true;

    const result = await apiCall('/api/ai/generate_image', 'POST', { prompt: title });
    if (result && result.success) {
        statusDiv.textContent = 'AI image generated!';
        imageUrlInput.value = result.file_url;
        previewContainer.innerHTML = `<img src="${result.file_url}" class="img-fluid rounded" alt="AI Generated Image">`;
    } else {
        statusDiv.textContent = 'AI image generation failed.';
    }
    button.disabled = false;
}

async function handleAIContinueWriting() { /* ... (code from previous message) ... */ }
async function handleAIRephrase() { /* ... (code from previous message) ... */ }
async function handleAISuggestHeadlines() {
    const content = tinymce.get('content-editor').getContent({ format: 'text' });
    if (content.length < 100) { alert('Write at least 100 characters before suggesting headlines.'); return; }
    const result = await apiCall('/api/ai/generate_headlines', 'POST', { content });
    if (result && result.headlines) {
        const suggestionsHtml = '<h6>AI Headline Suggestions:</h6><ul class="list-group">' +
            result.headlines.map(h => `<li class="list-group-item list-group-item-action clickable" onclick="useHeadline('${h}')">${h.replace(/^\d+\.\s*/, '')}</li>`).join('') + '</ul>';
        document.getElementById('headline-suggestions').innerHTML = suggestionsHtml;
    }
}
function useHeadline(headline) {
    document.getElementById('title').value = headline.replace(/^\d+\.\s*/, '');
}

async function handleSEOAnalysis(content) {
    const result = await apiCall('/api/ai/seo_analysis', 'POST', { content });
    if (result && result.analysis) {
        document.getElementById('seo-analysis-content').innerHTML = `<p>${result.analysis.replace(/\n/g, '<br>')}</p>`;
    } else {
        document.getElementById('seo-analysis-content').textContent = 'Could not analyze SEO.';
    }
}

// --- INITIALIZATION ---
async function initializeApp() { /* ... same as before ... */ }
document.addEventListener('DOMContentLoaded', initializeApp);