// YouTube Watch Later Bulk Delete - Content Script
class YouTubeBulkDelete {
  constructor() {
    this.isEnabled = false;
    this.selectedVideos = new Set();
    this.isDeleting = false;
    this.totalVideos = 0;
    this.deletionQueue = [];
    this.currentDeletionIndex = 0;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.baseDelay = 2000;
    this.maxDelay = 10000;
    this.container = null;
    this.observer = null;
    this.checkboxObserver = null;
    this.lastUrl = '';
    this.debugMode = false;
    this.statsData = {
      sessionsCount: 0,
      totalDeletedVideos: 0,
      totalSessionTime: 0,
      averageDeleteTime: 0,
      lastUsed: null
    };
    this.currentSessionStats = {
      startTime: Date.now(),
      deletedInSession: 0,
      errorsInSession: 0
    };
    
    // Drag functionality state
    this.dragState = {
      isDragging: false,
      dragOffset: { x: 0, y: 0 },
      originalPosition: null
    };
    
    this.init();
  }
  
  async init() {
    try {
      console.log('🚀 YouTube Bulk Delete: Initializing...');
      
      // Check if we're on the Watch Later page
      if (!this.isWatchLaterPage()) {
        console.log('❌ Not on Watch Later page, skipping initialization');
        return;
      }
      
      // Wait for page to be fully loaded
      await this.waitForPageLoad();
      console.log('✅ Page loaded');
      
      // Load saved state
      await this.loadState();
      console.log('✅ State loaded');
      
      // Set up DOM observer for dynamic content
      this.setupObserver();
      console.log('✅ Observer set up');
      
      // Create UI container
      this.createContainer();
      console.log('✅ Container created');
      
      // Set up message listener
      this.setupMessageListener();
      console.log('✅ Message listener set up');
      
      console.log('🎉 YouTube Bulk Delete: Initialization completed');
      
    } catch (error) {
      console.error('❌ Error during initialization:', error);
    }
  }
  
  isWatchLaterPage() {
    const url = window.location.href;
    return url.includes('youtube.com/playlist?list=WL') || 
           url.includes('youtube.com/watch') && url.includes('list=WL');
  }
  
  async waitForPageLoad() {
    // Wait for basic YouTube structure
    await this.waitForElement('#page-manager');
    
    // Wait for playlist content
    await this.waitForElement('ytd-playlist-video-list');
    
    // Additional wait for dynamic content
    await this.delay(2000);
  }
  
  waitForElement(selector, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }
      
      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async loadState() {
    try {
      const result = await chrome.storage.local.get([
        'bulkDeleteEnabled',
        'selectedVideos',
        'statsData',
        'containerPosition'
      ]);
      
      this.isEnabled = result.bulkDeleteEnabled || false;
      this.selectedVideos = new Set(result.selectedVideos || []);
      this.statsData = { ...this.statsData, ...(result.statsData || {}) };
      
      // Load container position for drag functionality
      if (result.containerPosition) {
        this.savedPosition = result.containerPosition;
      }
      
      console.log('📊 State loaded:', {
        enabled: this.isEnabled,
        selectedCount: this.selectedVideos.size,
        stats: this.statsData
      });
      
    } catch (error) {
      console.error('❌ Error loading state:', error);
    }
  }
  
  async saveState() {
    try {
      const stateData = {
        bulkDeleteEnabled: this.isEnabled,
        selectedVideos: Array.from(this.selectedVideos),
        statsData: this.statsData
      };
      
      // Save container position for drag functionality
      if (this.container && this.container.style.left && this.container.style.top) {
        stateData.containerPosition = {
          left: this.container.style.left,
          top: this.container.style.top
        };
      }
      
      await chrome.storage.local.set(stateData);
      console.log('✅ State saved');
      
    } catch (error) {
      console.error('❌ Error saving state:', error);
    }
  }
  
  setupObserver() {
    // Observe DOM changes for dynamic content loading
    this.observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      
      mutations.forEach((mutation) => {
        // Check for new video elements
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const videoElements = node.querySelectorAll ? 
                node.querySelectorAll('ytd-playlist-video-renderer') : [];
              
              if (node.matches && node.matches('ytd-playlist-video-renderer')) {
                shouldUpdate = true;
              } else if (videoElements.length > 0) {
                shouldUpdate = true;
              }
            }
          });
        }
      });
      
      if (shouldUpdate && this.isEnabled) {
        // Debounce updates
        clearTimeout(this.updateTimeout);
        this.updateTimeout = setTimeout(() => {
          this.addCheckboxesToVideos();
          this.updateUI();
        }, 500);
      }
    });
    
    // Start observing
    const targetNode = document.querySelector('#page-manager') || document.body;
    this.observer.observe(targetNode, {
      childList: true,
      subtree: true
    });
  }
  
  createContainer() {
    if (this.container) {
      this.container.remove();
    }
    
    this.container = document.createElement('div');
    this.container.className = 'bulk-delete-container';
    
    // Apply saved position if available
    if (this.savedPosition) {
      this.container.style.left = this.savedPosition.left;
      this.container.style.top = this.savedPosition.top;
    }
    
    this.container.innerHTML = `
      <div class="bulk-delete-header">
        <h3>一括削除モード</h3>
        <button class="toggle-button" data-enabled="${this.isEnabled}">
          ${this.isEnabled ? '無効にする' : '有効にする'}
        </button>
      </div>
      <div class="bulk-delete-controls" style="display: ${this.isEnabled ? 'block' : 'none'}">
        <div class="filter-section">
          <input type="text" id="title-filter" class="filter-input" placeholder="タイトルで絞り込み..." />
          <input type="text" id="range-filter" class="filter-input range-input" placeholder="範囲指定 (例: 1-10, 5-, -20)" />
          <div class="filter-info">
            <small>範囲例: "1-10"(1~10番目), "5-"(5番目以降), "-20"(最初から20番目まで)</small>
          </div>
        </div>
        <div class="control-buttons">
          <button class="control-btn" id="select-all-btn">全て選択</button>
          <button class="control-btn" id="deselect-all-btn">全て解除</button>
          <button class="control-btn" id="select-filtered-btn">表示分選択</button>
          <button class="control-btn" id="invert-selection-btn">選択反転</button>
        </div>
        <div class="delete-buttons">
          <button class="delete-btn" id="delete-selected-btn">
            選択した動画を削除 (<span id="selected-count">0</span>個)
          </button>
          <button class="delete-btn delete-all-btn" id="delete-all-btn">表示中の全動画を削除</button>
        </div>
        <div class="progress-section" id="progress-section" style="display: none;">
          <div class="progress-info">
            <span id="progress-text">0 / 0</span>
            <span id="progress-percentage">0%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
          <button class="cancel-btn" id="cancel-btn">キャンセル</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.container);
    
    // Set up drag functionality
    this.setupDragFunctionality();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Initialize UI
    this.updateUI();
  }
  
  setupDragFunctionality() {
    const header = this.container.querySelector('.bulk-delete-header');
    if (!header) return;
    
    // Initialize drag state
    this.dragState = {
      isDragging: false,
      dragOffset: { x: 0, y: 0 },
      originalPosition: null
    };
    
    // Mouse event handlers
    this.dragMouseDownHandler = (e) => {
      // Only start drag on left mouse button and header area
      if (e.button !== 0) return;
      if (e.target.classList.contains('toggle-button')) return;
      
      this.dragState.isDragging = true;
      this.container.classList.add('dragging');
      
      const rect = this.container.getBoundingClientRect();
      this.dragState.dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      
      this.dragState.originalPosition = {
        left: rect.left,
        top: rect.top
      };
      
      // Prevent text selection during drag
      e.preventDefault();
      
      // Add global event listeners
      document.addEventListener('mousemove', this.dragMouseMoveHandler);
      document.addEventListener('mouseup', this.dragMouseUpHandler);
      
      console.log('🖱️ Drag started');
    };
    
    this.dragMouseMoveHandler = (e) => {
      if (!this.dragState.isDragging) return;
      
      e.preventDefault();
      
      // Calculate new position
      let newLeft = e.clientX - this.dragState.dragOffset.x;
      let newTop = e.clientY - this.dragState.dragOffset.y;
      
      // Constrain to viewport
      const rect = this.container.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      newLeft = Math.max(0, Math.min(newLeft, viewportWidth - rect.width));
      newTop = Math.max(0, Math.min(newTop, viewportHeight - rect.height));
      
      // Apply position
      this.container.style.left = newLeft + 'px';
      this.container.style.top = newTop + 'px';
      this.container.style.right = 'auto';
    };
    
    this.dragMouseUpHandler = (e) => {
      if (!this.dragState.isDragging) return;
      
      this.dragState.isDragging = false;
      this.container.classList.remove('dragging');
      
      // Remove global event listeners
      document.removeEventListener('mousemove', this.dragMouseMoveHandler);
      document.removeEventListener('mouseup', this.dragMouseUpHandler);
      
      // Save new position
      this.saveState();
      
      console.log('🖱️ Drag ended at:', {
        left: this.container.style.left,
        top: this.container.style.top
      });
      
      e.preventDefault();
    };
    
    // Attach mouse down handler to header
    header.addEventListener('mousedown', this.dragMouseDownHandler);
  }
  
  setupEventListeners() {
    const toggleBtn = this.container.querySelector('.toggle-button');
    const selectAllBtn = this.container.querySelector('#select-all-btn');
    const deselectAllBtn = this.container.querySelector('#deselect-all-btn');
    const selectFilteredBtn = this.container.querySelector('#select-filtered-btn');
    const invertSelectionBtn = this.container.querySelector('#invert-selection-btn');
    const deleteSelectedBtn = this.container.querySelector('#delete-selected-btn');
    const deleteAllBtn = this.container.querySelector('#delete-all-btn');
    const cancelBtn = this.container.querySelector('#cancel-btn');
    const titleFilter = this.container.querySelector('#title-filter');
    const rangeFilter = this.container.querySelector('#range-filter');
    
    // Toggle button
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent drag
      this.toggleMode();
    });
    
    // Control buttons
    selectAllBtn.addEventListener('click', () => this.selectAllVideos());
    deselectAllBtn.addEventListener('click', () => this.deselectAllVideos());
    selectFilteredBtn.addEventListener('click', () => this.selectFilteredVideos());
    invertSelectionBtn.addEventListener('click', () => this.invertSelection());
    
    // Delete buttons  
    deleteSelectedBtn.addEventListener('click', () => this.deleteSelectedVideos());
    deleteAllBtn.addEventListener('click', () => this.deleteAllVideos());
    cancelBtn.addEventListener('click', () => this.cancelDeletion());
    
    // Filter inputs
    titleFilter.addEventListener('input', () => this.applyFilters());
    rangeFilter.addEventListener('input', () => this.applyFilters());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.isEnabled) return;
      
      // Ctrl+A for select all
      if (e.ctrlKey && e.key === 'a' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        this.selectAllVideos();
      }
      
      // Escape to cancel deletion
      if (e.key === 'Escape' && this.isDeleting) {
        this.cancelDeletion();
      }
    });
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('📨 Message received:', request);
      
      switch (request.type) {
        case 'TOGGLE_MODE':
          this.toggleMode();
          sendResponse({ success: true, enabled: this.isEnabled });
          break;
          
        case 'GET_STATUS':
          sendResponse({
            isEnabled: this.isEnabled,
            selectedCount: this.selectedVideos.size,
            totalVideos: this.getTotalVideos(),
            isDeleting: this.isDeleting
          });
          break;
          
        case 'DELETE_SELECTED':
          if (this.selectedVideos.size > 0) {
            this.deleteSelectedVideos();
            sendResponse({ success: true, count: this.selectedVideos.size });
          } else {
            sendResponse({ success: false, message: 'No videos selected' });
          }
          break;
          
        case 'DELETE_ALL':
          this.deleteAllVideos();
          sendResponse({ success: true });
          break;
          
        // Debug commands
        case 'DEBUG_DELETE_PROCESS':
          this.debugDeleteProcess();
          sendResponse({ success: true });
          break;
          
        case 'TEST_ACTUAL_DELETE':
          this.testActualDelete();
          sendResponse({ success: true });
          break;
          
        case 'SIMPLE_DELETE_TEST':
          this.simpleDeleteTest();
          sendResponse({ success: true });
          break;
          
        default:
          console.warn('Unknown message type:', request.type);
          sendResponse({ success: false, message: 'Unknown message type' });
      }
      
      return true; // Keep message channel open for async responses
    });
  }
  
  toggleMode() {
    this.isEnabled = !this.isEnabled;
    console.log('🔄 Mode toggled:', this.isEnabled ? 'ENABLED' : 'DISABLED');
    
    const toggleBtn = this.container.querySelector('.toggle-button');
    const controls = this.container.querySelector('.bulk-delete-controls');
    
    toggleBtn.textContent = this.isEnabled ? '無効にする' : '有効にする';
    toggleBtn.dataset.enabled = this.isEnabled;
    controls.style.display = this.isEnabled ? 'block' : 'none';
    
    if (this.isEnabled) {
      this.addCheckboxesToVideos();
      this.startStatsSession();
    } else {
      this.removeCheckboxesFromVideos();
      this.clearFilters();
      this.endStatsSession();
    }
    
    this.updateUI();
    this.saveState();
    
    // Notify popup of status change
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      status: {
        isEnabled: this.isEnabled,
        selectedCount: this.selectedVideos.size,
        totalVideos: this.getTotalVideos(),
        isDeleting: this.isDeleting
      }
    });
  }
  
  addCheckboxesToVideos() {
    console.log('📋 Adding checkboxes to videos...');
    
    const videoElements = document.querySelectorAll('ytd-playlist-video-renderer');
    console.log(`🎬 Found ${videoElements.length} video elements`);
    
    videoElements.forEach((videoElement, index) => {
      // Skip if checkbox already exists
      if (videoElement.querySelector('.bulk-delete-checkbox')) {
        return;
      }
      
      // Get video ID from various possible sources
      const videoId = this.extractVideoId(videoElement);
      if (!videoId) {
        console.warn(`⚠️ Could not extract video ID for element ${index}`);
        return;
      }
      
      // Create checkbox container
      const checkboxContainer = document.createElement('div');
      checkboxContainer.className = 'checkbox-container';
      
      // Create checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'bulk-delete-checkbox';
      checkbox.dataset.videoId = videoId;
      checkbox.checked = this.selectedVideos.has(videoId);
      
      // Add event listener
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        this.handleCheckboxChange(checkbox, videoId);
      });
      
      // Add checkbox to container
      checkboxContainer.appendChild(checkbox);
      
      // Position container absolutely within video element
      videoElement.style.position = 'relative';
      videoElement.appendChild(checkboxContainer);
      
      console.log(`✅ Added checkbox for video ${index + 1}: ${videoId}`);
    });
    
    console.log('✅ Checkboxes added to all videos');
  }
  
  removeCheckboxesFromVideos() {
    const checkboxes = document.querySelectorAll('.checkbox-container');
    checkboxes.forEach(container => container.remove());
    
    // Reset selectedVideos
    this.selectedVideos.clear();
    this.updateUI();
    console.log('🗑️ All checkboxes removed');
  }
  
  extractVideoId(videoElement) {
    // Try multiple methods to extract video ID
    const methods = [
      // Method 1: From thumbnail link
      () => {
        const link = videoElement.querySelector('a[href*="/watch"]');
        if (link) {
          const url = new URL(link.href, window.location.origin);
          return url.searchParams.get('v');
        }
        return null;
      },
      
      // Method 2: From data attributes
      () => {
        return videoElement.dataset.videoId || 
               videoElement.getAttribute('data-video-id');
      },
      
      // Method 3: From nested elements
      () => {
        const thumbnail = videoElement.querySelector('ytd-thumbnail');
        if (thumbnail) {
          return thumbnail.dataset.videoId;
        }
        return null;
      },
      
      // Method 4: From href parsing with regex
      () => {
        const link = videoElement.querySelector('a[href*="watch"]');
        if (link) {
          const match = link.href.match(/[?&]v=([^&]+)/);
          return match ? match[1] : null;
        }
        return null;
      }
    ];
    
    for (const method of methods) {
      try {
        const videoId = method();
        if (videoId && videoId.length >= 10) { // YouTube video IDs are typically 11 characters
          return videoId;
        }
      } catch (error) {
        console.warn('Error extracting video ID:', error);
      }
    }
    
    return null;
  }
  
  handleCheckboxChange(checkbox, videoId) {
    if (checkbox.checked) {
      this.selectedVideos.add(videoId);
      console.log(`✅ Selected video: ${videoId}`);
    } else {
      this.selectedVideos.delete(videoId);
      console.log(`❌ Deselected video: ${videoId}`);
    }
    
    this.updateSelectedCount();
    this.saveState();
  }
  
  selectAllVideos() {
    console.log('📋 === SELECT ALL VIDEOS (VISIBLE ONLY) ===');
    
    const checkboxes = document.querySelectorAll('.bulk-delete-checkbox');
    console.log(`🔍 Found ${checkboxes.length} checkboxes to select`);
    
    // Check if filtering is active
    const titleFilter = document.getElementById('title-filter')?.value?.trim() || '';
    const rangeFilter = document.getElementById('range-filter')?.value?.trim() || '';
    const isFiltering = titleFilter || rangeFilter;
    
    if (isFiltering) {
      console.log('🔽 Filtering is active, clearing previous selections to prevent selecting hidden videos');
      // Clear previous selections when filtering to prevent deleting hidden videos
      this.selectedVideos.clear();
      const allCheckboxes = document.querySelectorAll('.bulk-delete-checkbox');
      allCheckboxes.forEach(cb => { cb.checked = false; });
    }
    
    this.performSelectAll(checkboxes);
  }
  
  performSelectAll(checkboxes) {
    if (checkboxes.length === 0) {
      this.showNotification('⚠️ 選択する動画が見つかりません');
      return;
    }
    
    let selectedCount = 0;
    let alreadySelected = 0;
    let hiddenCount = 0;
    let processedCount = 0;
    const newlySelectedVideoIds = [];
    
    checkboxes.forEach((checkbox, index) => {
      try {
        const videoId = checkbox.dataset.videoId;
        console.log(`📋 Processing checkbox ${index + 1}: videoId=${videoId}, checked=${checkbox.checked}`);
        
        if (!videoId) {
          console.warn(`⚠️ Checkbox ${index + 1} has no videoId`);
          return;
        }
        
        // Check if the parent video element is visible
        const parentContainer = checkbox.closest('ytd-playlist-video-renderer, ytd-video-renderer, [class*="video-renderer"]');
        if (parentContainer) {
          const isVisible = parentContainer.style.display !== 'none';
          
          if (!isVisible) {
            console.log(`⏭️ Checkbox ${index + 1}: Parent video is hidden, skipping`);
            hiddenCount++;
            return;
          }
        }
        
        processedCount++;
        
        if (!checkbox.checked) {
          // Select checkbox
          checkbox.checked = true;
          this.selectedVideos.add(videoId);
          newlySelectedVideoIds.push(videoId);
          selectedCount++;
          
          console.log(`✅ Selected checkbox ${index + 1}: ${videoId}`);
        } else {
          alreadySelected++;
          console.log(`ℹ️ Checkbox ${index + 1} was already selected: ${videoId}`);
        }
        
        // Update visual style
        const container = checkbox.parentElement;
        if (container && container.classList.contains('checkbox-container')) {
          container.style.backgroundColor = 'rgba(204, 0, 0, 0.9)';
          container.style.borderColor = 'rgba(255, 255, 255, 0.8)';
        }
        
        // Apply visual feedback to parent container
        if (parentContainer) {
          parentContainer.style.backgroundColor = 'rgba(255, 193, 7, 0.2)';
          parentContainer.style.border = '2px solid rgba(255, 193, 7, 0.5)';
        }
        
        // Trigger change event
        const changeEvent = new Event('change', { bubbles: false });
        checkbox.dispatchEvent(changeEvent);
        
      } catch (error) {
        console.error(`❌ Error processing checkbox ${index + 1}:`, error);
      }
    });
    
    console.log('');
    console.log('📊 Selection Results (Visible Videos Only):');
    console.log(`  - Total checkboxes found: ${checkboxes.length}`);
    console.log(`  - Hidden videos skipped: ${hiddenCount}`);
    console.log(`  - Visible videos processed: ${processedCount}`);
    console.log(`  - Newly selected: ${selectedCount}`);
    console.log(`  - Already selected: ${alreadySelected}`);
    console.log(`  - Total in selection set: ${this.selectedVideos.size}`);
    console.log('');
    
    // Force UI update
    this.updateSelectedCount();
    this.saveState();
    
    // Show notification with accurate count
    const visibleSelectedCount = selectedCount + alreadySelected;
    if (selectedCount > 0) {
      this.showNotification(`✅ 表示中の${selectedCount}個の動画を新たに選択しました（合計: ${this.selectedVideos.size}個）`);
    } else if (alreadySelected > 0) {
      this.showNotification(`ℹ️ 表示中のすべての動画（${alreadySelected}個）はすでに選択されています`);
    } else {
      this.showNotification('⚠️ 選択できる動画が見つかりません');
    }
    
    // Debug verification
    const finalCheckboxes = document.querySelectorAll('.bulk-delete-checkbox:checked');
    console.log(`✅ Final verification: ${finalCheckboxes.length} checkboxes are now checked`);
  }
  
  
  deselectAllVideos() {
    console.log('❌ === DESELECT ALL VIDEOS (VISIBLE ONLY) ===');
    
    const checkboxes = document.querySelectorAll('.bulk-delete-checkbox');
    console.log(`🔍 Found ${checkboxes.length} checkboxes to deselect`);
    
    if (checkboxes.length === 0) {
      this.showNotification('⚠️ 選択解除する動画が見つかりません');
      return;
    }
    
    let deselectedCount = 0;
    let alreadyDeselected = 0;
    let hiddenCount = 0;
    let processedCount = 0;
    const deselectedVideoIds = [];
    
    checkboxes.forEach((checkbox, index) => {
      try {
        const videoId = checkbox.dataset.videoId;
        console.log(`📋 Processing checkbox ${index + 1}: videoId=${videoId}, checked=${checkbox.checked}`);
        
        if (!videoId) {
          console.warn(`⚠️ Checkbox ${index + 1} has no videoId`);
          return;
        }
        
        // Check if the parent video element is visible
        const parentContainer = checkbox.closest('ytd-playlist-video-renderer, ytd-video-renderer, [class*="video-renderer"]');
        if (parentContainer) {
          const isVisible = parentContainer.style.display !== 'none';
          
          if (!isVisible) {
            console.log(`⏭️ Checkbox ${index + 1}: Parent video is hidden, skipping`);
            hiddenCount++;
            return;
          }
        }
        
        processedCount++;
        
        if (checkbox.checked) {
          // Uncheck checkbox
          checkbox.checked = false;
          
          // Update visual style
          const container = checkbox.parentElement;
          if (container && container.classList.contains('checkbox-container')) {
            container.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
            container.style.borderColor = 'rgba(255, 255, 255, 0.3)';
          }
          
          // Remove visual feedback from parent container
          if (parentContainer) {
            parentContainer.style.backgroundColor = '';
            parentContainer.style.border = '';
          }
          
          // Remove from selected set
          this.selectedVideos.delete(videoId);
          deselectedVideoIds.push(videoId);
          deselectedCount++;
          
          console.log(`❌ Deselected checkbox ${index + 1}: ${videoId}`);
          
          // Trigger change event
          const changeEvent = new Event('change', { bubbles: false });
          checkbox.dispatchEvent(changeEvent);
          
        } else {
          alreadyDeselected++;
          console.log(`ℹ️ Checkbox ${index + 1} was already deselected: ${videoId}`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing checkbox ${index + 1}:`, error);
      }
    });
    
    console.log('');
    console.log('📊 Deselection Results (Visible Videos Only):');
    console.log(`  - Total checkboxes found: ${checkboxes.length}`);
    console.log(`  - Hidden videos skipped: ${hiddenCount}`);
    console.log(`  - Visible videos processed: ${processedCount}`);
    console.log(`  - Newly deselected: ${deselectedCount}`);
    console.log(`  - Already deselected: ${alreadyDeselected}`);
    console.log(`  - Total in selection set: ${this.selectedVideos.size}`);
    console.log('');
    
    // Force UI update
    this.updateSelectedCount();
    this.saveState();
    
    // Show notification with accurate count
    if (deselectedCount > 0) {
      this.showNotification(`❌ 表示中の${deselectedCount}個の動画の選択を解除しました（残り: ${this.selectedVideos.size}個）`);
    } else if (alreadyDeselected > 0) {
      this.showNotification(`ℹ️ 表示中のすべての動画（${alreadyDeselected}個）は既に選択解除されています`);
    } else {
      this.showNotification('⚠️ 選択解除できる動画が見つかりません');
    }
    
    // Debug verification
    const finalCheckboxes = document.querySelectorAll('.bulk-delete-checkbox:checked');
    console.log(`✅ Final verification: ${finalCheckboxes.length} checkboxes are now checked`);
  }
  
  selectFilteredVideos() {
    console.log('🔍 === SELECT FILTERED VIDEOS ===');
    
    const visibleCheckboxes = this.getVisibleCheckboxes();
    console.log(`📋 Found ${visibleCheckboxes.length} visible checkboxes`);
    
    if (visibleCheckboxes.length === 0) {
      this.showNotification('⚠️ 表示中の動画が見つかりません');
      return;
    }
    
    // Check if filtering is active
    const titleFilter = document.getElementById('title-filter')?.value?.trim() || '';
    const rangeFilter = document.getElementById('range-filter')?.value?.trim() || '';
    const isFiltering = titleFilter || rangeFilter;
    
    if (isFiltering) {
      console.log('🔽 Filtering is active, clearing previous selections to prevent selecting hidden videos');
      // Clear previous selections when filtering to prevent deleting hidden videos
      this.selectedVideos.clear();
      const allCheckboxes = document.querySelectorAll('.bulk-delete-checkbox');
      allCheckboxes.forEach(cb => { cb.checked = false; });
    }
    
    this.performSelectAll(visibleCheckboxes);
  }
  
  getVisibleCheckboxes() {
    const allCheckboxes = document.querySelectorAll('.bulk-delete-checkbox');
    const visibleCheckboxes = [];
    
    allCheckboxes.forEach(checkbox => {
      const parentContainer = checkbox.closest('ytd-playlist-video-renderer, ytd-video-renderer, [class*="video-renderer"]');
      if (parentContainer && parentContainer.style.display !== 'none') {
        visibleCheckboxes.push(checkbox);
      }
    });
    
    return visibleCheckboxes;
  }
  
  invertSelection() {
    console.log('🔄 === INVERT SELECTION (VISIBLE ONLY) ===');
    
    const checkboxes = document.querySelectorAll('.bulk-delete-checkbox');
    console.log(`🔍 Found ${checkboxes.length} checkboxes to invert`);
    
    if (checkboxes.length === 0) {
      this.showNotification('⚠️ 反転する動画が見つかりません');
      return;
    }
    
    let invertedCount = 0;
    let hiddenCount = 0;
    let processedCount = 0;
    
    checkboxes.forEach((checkbox, index) => {
      try {
        const videoId = checkbox.dataset.videoId;
        
        if (!videoId) {
          console.warn(`⚠️ Checkbox ${index + 1} has no videoId`);
          return;
        }
        
        // Check if the parent video element is visible
        const parentContainer = checkbox.closest('ytd-playlist-video-renderer, ytd-video-renderer, [class*="video-renderer"]');
        if (parentContainer) {
          const isVisible = parentContainer.style.display !== 'none';
          
          if (!isVisible) {
            console.log(`⏭️ Checkbox ${index + 1}: Parent video is hidden, skipping`);
            hiddenCount++;
            return;
          }
        }
        
        processedCount++;
        
        // Invert selection
        const wasChecked = checkbox.checked;
        checkbox.checked = !wasChecked;
        
        if (checkbox.checked) {
          this.selectedVideos.add(videoId);
        } else {
          this.selectedVideos.delete(videoId);
        }
        
        // Update visual style
        const container = checkbox.parentElement;
        if (container && container.classList.contains('checkbox-container')) {
          if (checkbox.checked) {
            container.style.backgroundColor = 'rgba(204, 0, 0, 0.9)';
            container.style.borderColor = 'rgba(255, 255, 255, 0.8)';
          } else {
            container.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
            container.style.borderColor = 'rgba(255, 255, 255, 0.3)';
          }
        }
        
        invertedCount++;
        console.log(`🔄 Inverted checkbox ${index + 1}: ${videoId} (${wasChecked ? 'deselected' : 'selected'})`);
        
        // Trigger change event
        const changeEvent = new Event('change', { bubbles: false });
        checkbox.dispatchEvent(changeEvent);
        
      } catch (error) {
        console.error(`❌ Error processing checkbox ${index + 1}:`, error);
      }
    });
    
    console.log('');
    console.log('📊 Inversion Results (Visible Videos Only):');
    console.log(`  - Total checkboxes found: ${checkboxes.length}`);
    console.log(`  - Hidden videos skipped: ${hiddenCount}`);
    console.log(`  - Visible videos processed: ${processedCount}`);
    console.log(`  - Selections inverted: ${invertedCount}`);
    console.log(`  - Total in selection set: ${this.selectedVideos.size}`);
    console.log('');
    
    // Force UI update
    this.updateSelectedCount();
    this.saveState();
    
    // Show notification
    if (invertedCount > 0) {
      this.showNotification(`🔄 表示中の${invertedCount}個の動画の選択を反転しました（選択中: ${this.selectedVideos.size}個）`);
    } else {
      this.showNotification('⚠️ 反転できる動画が見つかりません');
    }
  }
  
  applyFilters() {
    const titleFilter = document.getElementById('title-filter').value.toLowerCase().trim();
    const rangeFilter = document.getElementById('range-filter').value.trim();
    
    console.log('🔍 Applying filters:', { titleFilter, rangeFilter });
    
    const videoElements = document.querySelectorAll('ytd-playlist-video-renderer');
    let visibleCount = 0;
    let hiddenCount = 0;
    
    videoElements.forEach((videoElement, index) => {
      let shouldShow = true;
      
      // Title filter
      if (titleFilter) {
        const titleElement = videoElement.querySelector('#video-title, [id*="video-title"], a[aria-label]');
        const title = titleElement ? 
          (titleElement.textContent || titleElement.getAttribute('aria-label') || '').toLowerCase() : '';
        
        if (!title.includes(titleFilter)) {
          shouldShow = false;
        }
      }
      
      // Range filter
      if (rangeFilter && shouldShow) {
        const videoIndex = index + 1; // 1-based indexing for user-friendly display
        
        if (rangeFilter.includes('-')) {
          const [start, end] = rangeFilter.split('-').map(s => s.trim());
          
          if (start && end) {
            // Range: start-end
            const startNum = parseInt(start);
            const endNum = parseInt(end);
            if (!isNaN(startNum) && !isNaN(endNum)) {
              shouldShow = videoIndex >= startNum && videoIndex <= endNum;
            }
          } else if (start && !end) {
            // Range: start- (from start to end)
            const startNum = parseInt(start);
            if (!isNaN(startNum)) {
              shouldShow = videoIndex >= startNum;
            }
          } else if (!start && end) {
            // Range: -end (from beginning to end)
            const endNum = parseInt(end);
            if (!isNaN(endNum)) {
              shouldShow = videoIndex <= endNum;
            }
          }
        } else {
          // Single number
          const num = parseInt(rangeFilter);
          if (!isNaN(num)) {
            shouldShow = videoIndex === num;
          }
        }
      }
      
      // Apply visibility
      if (shouldShow) {
        videoElement.style.display = '';
        visibleCount++;
      } else {
        videoElement.style.display = 'none';
        hiddenCount++;
      }
    });
    
    console.log(`📊 Filter results: ${visibleCount} visible, ${hiddenCount} hidden`);
    
    // Clean up selections for hidden videos to prevent accidental deletion
    this.cleanupHiddenVideoSelections();
    
    // Update UI
    this.updateUI();
    
    // Show notification if filters are active
    if (titleFilter || rangeFilter) {
      this.showNotification(`🔍 フィルター適用: ${visibleCount}個の動画を表示中`);
    }
  }
  
  cleanupHiddenVideoSelections() {
    console.log('🧹 Cleaning up selections for hidden videos...');
    let cleanedCount = 0;
    
    const checkboxes = document.querySelectorAll('.bulk-delete-checkbox');
    checkboxes.forEach((checkbox, index) => {
      const videoId = checkbox.dataset.videoId;
      if (!videoId) return;
      
      const parentContainer = checkbox.closest('ytd-playlist-video-renderer, ytd-video-renderer, [class*="video-renderer"]');
      if (parentContainer) {
        const isHidden = parentContainer.style.display === 'none';
        
        if (isHidden && checkbox.checked) {
          console.log(`🧹 Cleaning up hidden video selection: ${videoId}`);
          checkbox.checked = false;
          this.selectedVideos.delete(videoId);
          
          // Update visual style
          const container = checkbox.parentElement;
          if (container && container.classList.contains('checkbox-container')) {
            container.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
            container.style.borderColor = 'rgba(255, 255, 255, 0.3)';
          }
          
          cleanedCount++;
        }
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} hidden video selections`);
      this.updateSelectedCount();
      this.saveState();
    }
  }
  
  clearFilters() {
    document.getElementById('title-filter').value = '';
    document.getElementById('range-filter').value = '';
    
    // Show all videos
    const videoElements = document.querySelectorAll('ytd-playlist-video-renderer');
    videoElements.forEach(videoElement => {
      videoElement.style.display = '';
    });
    
    console.log('🔍 Filters cleared, all videos visible');
  }
  
  async deleteSelectedVideos() {
    if (this.selectedVideos.size === 0) {
      this.showNotification('⚠️ 削除する動画が選択されていません');
      return;
    }
    
    if (this.isDeleting) {
      this.showNotification('⚠️ 既に削除処理中です');
      return;
    }
    
    // Safety check: Only delete visible videos
    const visibleSelectedVideos = new Set();
    const checkboxes = document.querySelectorAll('.bulk-delete-checkbox:checked');
    
    checkboxes.forEach(checkbox => {
      const videoId = checkbox.dataset.videoId;
      if (!videoId) return;
      
      const parentContainer = checkbox.closest('ytd-playlist-video-renderer, ytd-video-renderer, [class*="video-renderer"]');
      if (parentContainer && parentContainer.style.display !== 'none') {
        visibleSelectedVideos.add(videoId);
      }
    });
    
    console.log(`🎯 Filtering selected videos for deletion:`);
    console.log(`  - Total selected: ${this.selectedVideos.size}`);
    console.log(`  - Visible selected: ${visibleSelectedVideos.size}`);
    console.log(`  - Hidden selected (will be excluded): ${this.selectedVideos.size - visibleSelectedVideos.size}`);
    
    if (visibleSelectedVideos.size === 0) {
      this.showNotification('⚠️ 削除対象の表示中の動画がありません');
      return;
    }
    
    // Show confirmation
    const shouldDelete = confirm(`選択された${visibleSelectedVideos.size}個の動画を削除しますか？\n\n⚠️ この操作は元に戻せません！`);
    if (!shouldDelete) {
      return;
    }
    
    // Start deletion process with only visible selected videos
    this.startDeletion(Array.from(visibleSelectedVideos));
  }
  
  async deleteAllVideos() {
    if (this.isDeleting) {
      this.showNotification('⚠️ 既に削除処理中です');
      return;
    }
    
    // Get visible videos only
    const visibleVideoIds = [];
    const visibleCheckboxes = this.getVisibleCheckboxes();
    
    visibleCheckboxes.forEach(checkbox => {
      const videoId = checkbox.dataset.videoId;
      if (videoId) {
        visibleVideoIds.push(videoId);
      }
    });
    
    console.log(`🎯 Preparing to delete all visible videos: ${visibleVideoIds.length} videos`);
    
    if (visibleVideoIds.length === 0) {
      this.showNotification('⚠️ 削除する表示中の動画がありません');
      return;
    }
    
    // Show confirmation
    const shouldDelete = confirm(`表示中のすべての動画（${visibleVideoIds.length}個）を削除しますか？\n\n⚠️ この操作は元に戻せません！`);
    if (!shouldDelete) {
      return;
    }
    
    // Start deletion process
    this.startDeletion(visibleVideoIds);
  }
  
  showNotification(message, duration = 5000) {
    // Remove existing notification
    const existingNotification = document.querySelector('.bulk-delete-notification');
    if (existingNotification) {
      existingNotification.remove();
    }
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = 'bulk-delete-notification';
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Auto remove after duration
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, duration);
    
    console.log(`📢 Notification: ${message}`);
  }
  
  getTotalVideos() {
    return document.querySelectorAll('ytd-playlist-video-renderer').length;
  }
  
  updateSelectedCount() {
    const selectedCountSpan = this.container.querySelector('#selected-count');
    if (selectedCountSpan) {
      selectedCountSpan.textContent = this.selectedVideos.size;
    }
    
    // Update delete button state
    const deleteSelectedBtn = this.container.querySelector('#delete-selected-btn');
    if (deleteSelectedBtn) {
      deleteSelectedBtn.disabled = this.selectedVideos.size === 0 || this.isDeleting;
    }
  }
  
  updateUI() {
    if (!this.container) return;
    
    this.updateSelectedCount();
    
    // Update total videos count
    this.totalVideos = this.getTotalVideos();
    
    // Update button states
    const buttons = this.container.querySelectorAll('button:not(.toggle-button)');
    buttons.forEach(button => {
      if (!button.id.includes('cancel')) {
        button.disabled = this.isDeleting;
      }
    });
    
    // Update delete all button text
    const deleteAllBtn = this.container.querySelector('#delete-all-btn');
    if (deleteAllBtn) {
      const visibleCount = this.getVisibleCheckboxes().length;
      deleteAllBtn.textContent = `表示中の全動画を削除 (${visibleCount}個)`;
    }
  }
  
  // Stats methods
  startStatsSession() {
    this.currentSessionStats = {
      startTime: Date.now(),
      deletedInSession: 0,
      errorsInSession: 0
    };
    
    this.statsData.sessionsCount++;
    this.statsData.lastUsed = new Date().toISOString();
  }
  
  endStatsSession() {
    const sessionDuration = Date.now() - this.currentSessionStats.startTime;
    this.statsData.totalSessionTime += sessionDuration;
    
    if (this.statsData.sessionsCount > 0) {
      this.statsData.averageDeleteTime = this.statsData.totalSessionTime / this.statsData.totalDeletedVideos;
    }
    
    this.saveState();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new YouTubeBulkDelete();
  });
} else {
  new YouTubeBulkDelete();
}

// Handle navigation changes (YouTube is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('🔄 Navigation detected, reinitializing...');
    
    // Small delay to let YouTube load
    setTimeout(() => {
      new YouTubeBulkDelete();
    }, 1000);
  }
}).observe(document, { subtree: true, childList: true });