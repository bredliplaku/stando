// Stable entry point for downloaded website files. Mount Stando as a full page
// so NFC, sign-in and storage use the website the visitor actually opened.
(function () {
    'use strict';
    const entry = document.currentScript;
    if (!entry || window.STANDO_EMBEDDED) return;
    window.STANDO_EMBEDDED = true;
    const appBase = new URL('./', entry.src);
    const iconSelector = 'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]';
    const hostIcons = [...document.querySelectorAll(iconSelector)].map(link => {
        const copy = link.cloneNode(true);
        copy.href = link.href;
        return copy;
    });
    if (!hostIcons.some(link => link.relList.contains('icon'))) {
        const icon = document.createElement('link');
        icon.rel = 'icon';
        icon.href = new URL('/favicon.ico', location.origin).href;
        hostIcons.push(icon);
    }

    function loadScript(source) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            for (const name of ['src', 'type', 'integrity', 'crossorigin', 'referrerpolicy']) {
                if (source.hasAttribute(name)) script.setAttribute(name, source.getAttribute(name));
            }
            script.async = false;
            const timer = setTimeout(() => finish(new Error('Script timed out: ' + script.src)), 20000);
            function finish(error) {
                clearTimeout(timer);
                script.onload = script.onerror = null;
                if (error) {
                    script.remove();
                    reject(error);
                } else resolve();
            }
            script.onload = () => finish();
            script.onerror = () => finish(new Error('Script unavailable: ' + script.src));
            document.head.appendChild(script);
        });
    }

    function waitForStyle(link) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('Stylesheet timed out')), 15000);
            function finish(error) {
                clearTimeout(timer);
                link.onload = link.onerror = null;
                if (error && !link.hasAttribute('data-stando-optional')) reject(error);
                else resolve();
            }
            link.onload = () => finish();
            link.onerror = () => finish(new Error('Stylesheet unavailable'));
        });
    }

    function showError(error) {
        console.error('Stando could not load:', error);
        let notice = document.getElementById('stando-load-error');
        if (!notice) {
            notice = document.createElement('main');
            notice.id = 'stando-load-error';
            notice.setAttribute('role', 'alert');
            notice.style.cssText = 'max-width:32rem;margin:15vh auto;padding:24px;font:16px/1.5 system-ui';
            const title = document.createElement('h1');
            title.textContent = 'Stando unavailable';
            title.style.color = 'inherit';
            const detail = document.createElement('p');
            detail.textContent = 'Check your connection and try again.';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = 'Try again';
            retry.onclick = () => location.reload();
            notice.append(title, detail, retry);
            document.body.replaceChildren(notice);
        }
        notice.hidden = false;
    }

    // Choose the startup skeleton, as the startup script in index.html does (it is
    // not replayed here): signed out unless a session is stored or a Google redirect
    // is returning, otherwise the view this browser showed last.
    function markStartupView() {
        const root = document.documentElement;
        let view = 'signed-out';
        try {
            const stored = Object.keys(localStorage).some(k => k.startsWith('sb-') && k.includes('auth-token'));
            if (stored || /[?#&](code|access_token)=/.test(location.href)) {
                const last = localStorage.getItem('stando_view');
                view = ['student', 'lecturer', 'global'].includes(last) ? last : 'student';
            }
        } catch { /* Storage blocked: the sign-in skeleton. */ }
        root.dataset.standoView = view;
        // The same test as scripts.js: the browser offers Web NFC on an HTTPS page.
        if ('NDEFReader' in window && window.isSecureContext) root.dataset.standoNfc = '';
    }

    async function mount() {
        markStartupView();
        if (document.readyState === 'loading') {
            await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
        }
        const response = await fetch(new URL('index.html', appBase), {
            credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error('Application unavailable');
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (!page.getElementById('main-container') || !page.getElementById('app-loading')) {
            throw new Error('Invalid application page');
        }

        const scripts = [...page.querySelectorAll('script[src]')].map(source => {
            source.setAttribute('src', new URL(source.getAttribute('src'), appBase).href);
            return source;
        });
        // The downloaded HTML already applies the initial theme. The application
        // scripts below handle startup; do not replay inline bootstrap scripts.
        page.querySelectorAll('script, base, #stando-startup-theme').forEach(node => node.remove());
        page.querySelectorAll(iconSelector).forEach(node => node.remove());
        page.querySelectorAll('[src], link[href], video[poster]').forEach(node => {
            for (const attr of ['src', 'href', 'poster']) {
                if (node.hasAttribute(attr)) node.setAttribute(attr, new URL(node.getAttribute(attr), appBase).href);
            }
        });
        // Fragment links must stay on the host page; asset URLs above use appBase.
        page.head.append(...hostIcons);
        const themeColor = page.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.content = document.documentElement.classList.contains('dark-mode') ? '#000000' : '#f4f4f4';
        document.documentElement.lang = page.documentElement.lang || 'en';

        const startup = document.getElementById('stando-startup-theme');
        const styles = [...page.querySelectorAll('link[rel="stylesheet"]')];
        const stylesReady = Promise.all(styles.map(waitForStyle));
        document.head.replaceChildren(...(startup ? [startup] : []), ...page.head.childNodes);
        await stylesReady;
        document.body.className = page.body.className;
        document.body.replaceChildren(...page.body.childNodes);
        startup?.remove();

        for (const source of scripts) {
            try { await loadScript(source); }
            catch (error) {
                // One Tap and icon fonts may be blocked independently of sign-in.
                if (!source.hasAttribute('data-stando-optional')) throw error;
                console.warn(error.message);
            }
        }
    }

    mount().catch(showError);
})();
