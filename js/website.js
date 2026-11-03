// Published installation used by every downloaded index.html. Downloads always use
// this address, even when this script runs on another website. It is the only place
// the client names it; before changing it, read "Addresses" in the README.
(function () {
    'use strict';
    const APP_URL = 'https://bredliplaku.com/stando/';

    function loaderHtml() {
        const loaderUrl = new URL('embed.js', APP_URL).href
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f4f4f4">
  <title>Stando</title>
  <!-- Change /favicon.ico to the path to your website's own favicon. -->
  <link rel="icon" href="/favicon.ico">
  <!-- Apply the saved or system theme before the application loads. -->
  <style id="stando-startup-theme">
    html { color-scheme: light; background: #f4f4f4; color: #333; }
    html.dark-mode { color-scheme: dark; background: #000; color: #e0e0e0; }
    @media (prefers-color-scheme: dark) {
      html:not([data-stando-theme="light"]) { color-scheme: dark; background: #000; color: #e0e0e0; }
    }
    body { margin: 0; background: inherit; }
    #stando-load-error { max-width: 32rem; margin: 15vh auto; padding: 24px; font: 16px/1.5 system-ui; }
    #stando-load-error button { padding: 10px 20px; border: 0; border-radius: 20px; background: #2196f3; color: white; font: inherit; cursor: pointer; }
  </style>
  <script>
    (function () {
      let theme = 'auto';
      try { theme = localStorage.getItem('theme') || 'auto'; } catch {}
      if (!['auto', 'light', 'dark'].includes(theme)) theme = 'auto';
      document.documentElement.dataset.standoTheme = theme;
      const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark-mode', dark);
      document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#f4f4f4';
    })();
  <\/script>
  <!-- To show the cat companion, add data-stando-cat to the script tag below. -->
  <script defer src="${loaderUrl}" onerror="document.getElementById('stando-load-error').hidden = false"><\/script>
</head>
<body>
  <main id="stando-load-error" hidden role="alert">
    <h1>Stando unavailable</h1>
    <p>Check your connection and try again.</p>
    <button type="button" onclick="location.reload()">Try again</button>
  </main>
  <noscript>Please enable JavaScript to use Stando.</noscript>
</body>
</html>
`;
    }

    function download() {
        const url = URL.createObjectURL(new Blob([loaderHtml()], { type: 'text/html;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'index.html';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // Lecturers need the administrator to approve their website; global
    // administrators approve websites themselves.
    function addDownloadControl(container, { forGlobalAdmin = false } = {}) {
        if (!container || container.querySelector('.website-download')) return;
        const section = document.createElement('div');
        section.className = 'website-download';
        section.innerHTML = `
            <div class="website-download-copy">
                <strong>Stando on your website</strong>
                <p>${forGlobalAdmin ? 'Upload it to a folder on any approved website.' : 'Contact the administrator to activate your index.html.'}</p>
                <p class="website-download-error" role="status" hidden></p>
            </div>
            <button type="button" class="btn-blue btn-sm"><i class="fa-solid fa-download" aria-hidden="true"></i> Download index.html</button>`;
        section.querySelector('button').addEventListener('click', () => {
            const error = section.querySelector('.website-download-error');
            error.hidden = true;
            try { download(); }
            catch (cause) {
                console.error('Website download failed:', cause);
                error.textContent = 'Could not download. Reload and try again.';
                error.hidden = false;
            }
        });
        container.prepend(section);
    }

    window.StandoWebsite = { loaderHtml, addDownloadControl };
})();
