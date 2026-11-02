/**
 * Aran Cloud App Shell (shell.js)
 * Shared sidebar, top bar, health dot, Projector toggle, workspace switcher,
 * key handling (#key= fragment with sessionStorage and history.replaceState),
 * and admin key verification modal.
 */

(function (window) {
  'use strict';

  const Shell = {
    activeKey: '',
    adminKey: '',
    tenant: null,
    currentPage: '',

    init: function (activePage) {
      this.currentPage = activePage || 'overview';
      this.resolveKeys();
      this.initProjectorMode();
      this.renderAppShell();
      this.startHealthPolling();
      this.loadWorkspaceMetadata();
    },

    resolveKeys: function () {
      // 1. Read #key= from URL fragment
      const hash = window.location.hash || '';
      if (hash.startsWith('#key=')) {
        const parsedKey = decodeURIComponent(hash.substring(5)).trim();
        if (parsedKey) {
          try {
            sessionStorage.setItem('aran_dashboard_key', parsedKey);
          } catch (e) {
            console.warn('sessionStorage unavailable', e);
          }
          this.activeKey = parsedKey;
        }
        // Remove key from address bar cleanly
        try {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        } catch (e) {}
      }

      // 2. Fall back to sessionStorage
      if (!this.activeKey) {
        try {
          this.activeKey = sessionStorage.getItem('aran_dashboard_key') || sessionStorage.getItem('aran_admin_key') || '';
          this.adminKey = sessionStorage.getItem('aran_admin_key') || '';
        } catch (e) {
          console.warn('sessionStorage read failed', e);
        }
      }

      // Default demo key fallback if accessed directly
      if (!this.activeKey) {
        this.activeKey = 'aran_live_REDACTED_EXAMPLE';
      }
    },

    getKey: function () {
      return this.activeKey;
    },

    initProjectorMode: function () {
      try {
        if (localStorage.getItem('aran_projector_mode') === 'true') {
          document.body.classList.add('projector-mode');
        }
      } catch (e) {}
    },

    toggleProjectorMode: function () {
      const isProjector = document.body.classList.toggle('projector-mode');
      try {
        localStorage.setItem('aran_projector_mode', isProjector ? 'true' : 'false');
      } catch (e) {}
      const btn = document.getElementById('shell-projector-btn');
      if (btn) {
        btn.innerText = isProjector ? 'Projector: ON' : 'Projector';
      }
    },

    renderAppShell: function () {
      const navItems = [
        { id: 'overview', label: 'Overview', href: '/app/overview.html', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
        { id: 'traffic', label: 'Live traffic', href: '/app/traffic.html', icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
        { id: 'trace', label: 'Trace a leak', href: '/app/trace.html', icon: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z' },
        { id: 'receipts', label: 'Erasure and receipts', href: '/app/receipts.html', icon: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z' },
        { id: 'audit', label: 'Audit log', href: '/app/audit.html', icon: 'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z' },
        { id: 'integrations', label: 'Integrations', href: '/app/integrations.html', icon: 'M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z' },
        { id: 'usage', label: 'Usage and plan', href: '/app/usage.html', icon: 'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z' }
      ];

      // Build Sidebar HTML
      const sidebarEl = document.getElementById('shell-sidebar');
      if (sidebarEl) {
        sidebarEl.className = 'app-sidebar';
        sidebarEl.innerHTML = `
          <div class="sidebar-header">
            <a href="/app/overview.html" class="brand-lockup">
              <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
                <rect width="32" height="32" rx="7" fill="#070913" />
                <path d="M16 4L6 8V16C6 22.5 10.3 27.5 16 29C21.7 27.5 26 22.5 26 16V8L16 4Z" stroke="#818CF8" stroke-width="1.8" fill="#12182B" />
                <path d="M11 22V15C11 12.5 13.2 10.5 16 10.5C18.8 10.5 21 12.5 21 15V22" stroke="#A5B4FC" stroke-width="1.8" stroke-linecap="round" />
              </svg>
              <span class="brand-name">Aran</span>
            </a>
          </div>

          <nav class="sidebar-nav" aria-label="Main Navigation">
            ${navItems.map(item => `
              <a href="${item.href}" class="nav-item ${this.currentPage === item.id ? 'active' : ''}" id="nav-${item.id}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="${item.icon}" />
                </svg>
                <span class="nav-label">${item.label}</span>
              </a>
            `).join('')}
          </nav>

          <div style="border-top: 1px solid var(--border-subtle); padding-top: var(--space-2); display: flex; flex-direction: column; gap: 4px;">
            <a href="/connect" class="nav-item" style="font-size: 13px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <span>Quick Connect</span>
            </a>
            <button id="shell-btn-signout" class="nav-item" style="background: none; border: none; width: 100%; text-align: left; cursor: pointer; font-size: 13px; color: var(--text-faint);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>Switch Workspace</span>
            </button>
          </div>
        `;
      }

      // Build Topbar HTML
      const topbarEl = document.getElementById('shell-topbar');
      if (topbarEl) {
        topbarEl.className = 'topbar';
        topbarEl.innerHTML = `
          <div class="topbar-left">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 16px;">🏢</span>
              <span id="shell-ws-name" style="font-weight: 600; color: var(--text-primary); font-size: 14px;">Demo Bank Ltd</span>
              <span id="shell-ws-id" class="mono" style="font-size: 11px; color: var(--text-muted); background: var(--bg-card); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-subtle);">t_...</span>
            </div>
            <span class="pill pill-accent" style="font-size: 11px; padding: 2px 8px;">PREVIEW</span>
          </div>

          <div class="topbar-right">
            <!-- Health dot -->
            <div class="health-indicator" id="shell-health-box" title="Aran Core Health Status">
              <span class="health-dot" id="shell-health-dot"></span>
              <span id="shell-health-text" style="font-size: 13px; color: var(--text-muted);">Core OK</span>
            </div>

            <!-- Projector mode toggle -->
            <button class="btn btn-secondary btn-sm" id="shell-projector-btn" title="High-contrast projector mode">
              Projector
            </button>

            <!-- User avatar -->
            <div class="avatar" id="shell-user-avatar" title="Signed in as Tenant Admin">DB</div>
          </div>
        `;

        document.getElementById('shell-projector-btn').addEventListener('click', () => {
          this.toggleProjectorMode();
        });
      }

      const signoutBtn = document.getElementById('shell-btn-signout');
      if (signoutBtn) {
        signoutBtn.addEventListener('click', () => {
          try {
            sessionStorage.removeItem('aran_dashboard_key');
            sessionStorage.removeItem('aran_admin_key');
          } catch (e) {}
          window.location.href = '/';
        });
      }
    },

    startHealthPolling: function () {
      const checkHealth = async () => {
        try {
          const res = await fetch('/v1/health');
          const data = await res.json();
          const dot = document.getElementById('shell-health-dot');
          const txt = document.getElementById('shell-health-text');
          if (dot && txt) {
            if (data.status === 'ok') {
              dot.style.background = 'var(--token-green-text)';
              txt.innerText = 'Core Online';
            } else {
              dot.style.background = 'var(--warning-amber-text)';
              txt.innerText = 'Degraded';
            }
          }
        } catch (e) {
          const dot = document.getElementById('shell-health-dot');
          const txt = document.getElementById('shell-health-text');
          if (dot && txt) {
            dot.style.background = 'var(--exposed-red-text)';
            txt.innerText = 'Offline';
          }
        }
      };

      checkHealth();
      setInterval(checkHealth, 15000);
    },

    loadWorkspaceMetadata: async function () {
      if (!this.activeKey) return;
      try {
        const res = await fetch('/v1/dashboard', {
          headers: { 'X-API-Key': this.activeKey }
        });
        if (res.ok) {
          const data = await res.json();
          this.tenant = data.tenant;
          const nameEl = document.getElementById('shell-ws-name');
          const idEl = document.getElementById('shell-ws-id');
          const avatarEl = document.getElementById('shell-user-avatar');
          if (nameEl && data.tenant) nameEl.innerText = data.tenant.name;
          if (idEl && data.tenant) idEl.innerText = data.tenant.id;
          if (avatarEl && data.tenant) {
            const initials = data.tenant.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            avatarEl.innerText = initials || 'DB';
          }
        }
      } catch (e) {
        console.warn('Workspace metadata fetch error:', e);
      }
    },

    toast: function (title, desc, type, duration) {
      type = type || 'info';
      duration = duration || 4000;
      let container = document.getElementById('shell-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'shell-toast-container';
        container.style.position = 'fixed';
        container.style.bottom = '24px';
        container.style.right = '24px';
        container.style.zIndex = '200';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '8px';
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.style.position = 'relative';
      toast.style.bottom = 'auto';
      toast.style.right = 'auto';

      let icon = '•';
      if (type === 'success') icon = '✓';
      if (type === 'error') icon = '✕';
      if (type === 'warning') icon = '!';

      toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <div class="toast-content">
          <div class="toast-title">${title}</div>
          ${desc ? `<div class="toast-desc">${desc}</div>` : ''}
        </div>
      `;

      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 200ms ease';
        setTimeout(() => toast.remove(), 250);
      }, duration);
    },

    requestAdminKey: function (actionName, callback) {
      // Check if adminKey is already stored in session
      if (this.adminKey) {
        callback(this.adminKey);
        return;
      }

      // Open Modal to request admin key
      let modalBackdrop = document.getElementById('shell-admin-key-modal');
      if (!modalBackdrop) {
        modalBackdrop = document.createElement('div');
        modalBackdrop.id = 'shell-admin-key-modal';
        modalBackdrop.className = 'modal-backdrop';
        modalBackdrop.innerHTML = `
          <div class="modal">
            <div class="modal-header">
              <h3 style="font-size: 18px; margin: 0;">Admin Key Required</h3>
              <button class="btn btn-ghost btn-sm" id="shell-admin-modal-close" style="padding: 4px 8px;">✕</button>
            </div>
            <div class="modal-body" style="margin-bottom: 20px;">
              <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">
                Action <strong style="color: var(--text-primary);">${actionName}</strong> requires an admin-scoped API key. This action is irreversible.
              </p>
              <label class="stat-label" style="display: block; margin-bottom: 6px;">Workspace Admin Key</label>
              <input type="password" id="shell-admin-key-input" class="input mono" placeholder="aran_live_..." style="width: 100%;">
              <span id="shell-admin-key-error" style="color: var(--exposed-red-text); font-size: 12px; margin-top: 6px; display: none;"></span>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" id="shell-admin-modal-cancel">Cancel</button>
              <button class="btn btn-primary" id="shell-admin-modal-confirm">Confirm & Authorise</button>
            </div>
          </div>
        `;
        document.body.appendChild(modalBackdrop);
      }

      modalBackdrop.classList.add('active');
      const input = document.getElementById('shell-admin-key-input');
      const errEl = document.getElementById('shell-admin-key-error');
      if (errEl) errEl.style.display = 'none';
      if (input) {
        input.value = '';
        input.focus();
      }

      const close = () => {
        modalBackdrop.classList.remove('active');
      };

      document.getElementById('shell-admin-modal-close').onclick = close;
      document.getElementById('shell-admin-modal-cancel').onclick = close;

      document.getElementById('shell-admin-modal-confirm').onclick = () => {
        const key = input.value.trim();
        if (!key) {
          errEl.innerText = 'Please enter an admin API key.';
          errEl.style.display = 'block';
          return;
        }
        this.adminKey = key;
        try {
          sessionStorage.setItem('aran_admin_key', key);
        } catch (e) {}
        close();
        callback(key);
      };
    }
  };

  window.Shell = Shell;
})(window);

