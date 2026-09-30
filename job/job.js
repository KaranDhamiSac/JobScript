// Job page: the full job description to copy, and your own tailored resume to attach.
// Opened by background.js with ?sid=<session> (the posting and the tab to fill live in
// storage.session). Optionally saves the description and resume to
// Downloads/JobScript/<Company>/<Job title>/ with the downloads permission, asked for on first use.
(function () {
  const S = JobScriptStorage;
  const DOWNLOADS = { permissions: ['downloads'] };
  const sid = new URLSearchParams(location.search).get('sid') || '';
  const $ = (id) => document.getElementById(id);

  let session = null;
  let uploaded = null; // { id, name }

  function setStatus(text) {
    $('status').textContent = text;
  }

  // One path segment: no slashes, reserved characters or leading dots; short enough for any OS.
  function segment(value, fallback) {
    const s = String(value || '')
      .replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 60)
      .trim();
    return s || fallback;
  }

  function folder() {
    return `JobScript/${segment(session.posting.company, 'Company')}/${segment(session.posting.title, 'Job')}`;
  }

  function descriptionText() {
    const p = session.posting;
    return [
      p.title && `Job title: ${p.title}`,
      p.company && `Company: ${p.company}`,
      p.url && `Link: ${p.url}`,
      `Saved: ${new Date().toLocaleDateString()}`,
      '',
      p.description.trim(),
      '',
    ].filter((line) => line !== false && line !== undefined).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Copy

  $('copy').addEventListener('click', async () => {
    const text = descriptionText();
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Fallback for browsers that block the async clipboard here.
      const area = $('description');
      const shown = area.value;
      area.value = text;
      area.select();
      document.execCommand('copy');
      area.value = shown;
      area.setSelectionRange(0, 0);
    }
    $('copy-status').textContent = 'Copied to your clipboard.';
    setTimeout(() => ($('copy-status').textContent = ''), 3000);
  });

  // ---------------------------------------------------------------------------
  // Saving to Downloads/JobScript/<Company>/<Job title>/

  function download(blob, filename, conflictAction) {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      chrome.downloads.download({ url, filename, conflictAction, saveAs: false }, (id) => {
        const err = chrome.runtime.lastError;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        if (err || id === undefined) reject(new Error((err && err.message) || 'Download failed'));
        else resolve(id);
      });
    });
  }

  async function saveDescription() {
    await download(new Blob([descriptionText()], { type: 'text/plain' }), `${folder()}/Job Description.txt`, 'overwrite');
  }

  async function saveResume() {
    const record = await S.getTailored(uploaded.id);
    const bin = atob(record.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await download(new Blob([bytes], { type: 'application/pdf' }), `${folder()}/${segment(record.name.replace(/\.pdf$/i, ''), 'Resume')}.pdf`, 'overwrite');
  }

  // Must be called directly from a click: browsers only allow permission prompts then.
  function askForDownloads() {
    return chrome.permissions.request(DOWNLOADS).catch(() => false);
  }

  $('save-description').addEventListener('click', () => {
    askForDownloads().then(async (granted) => {
      if (!granted) return setStatus('Saving to a folder needs permission to manage downloads.');
      try {
        await saveDescription();
        setStatus(`Saved to Downloads/${folder()}/Job Description.txt`);
      } catch (err) {
        setStatus('Couldn’t save: ' + err.message);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Your resume: upload, attach, fill

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  $('resume-input').addEventListener('change', async () => {
    const file = $('resume-input').files[0];
    $('resume-input').value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return setStatus('Please choose a PDF file.');
    if (file.size > S.MAX_RESUME_BYTES) return setStatus('That PDF is larger than 5 MB.');
    try {
      const record = S.sanitizeResume({ name: file.name, data: await readAsBase64(file), savedAt: new Date().toISOString() });
      const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
      await S.saveTailored(id, {
        ...record,
        createdAt: new Date().toISOString(),
        company: session.posting.company,
        title: session.posting.title,
        url: session.posting.url,
        uploaded: true,
      });
      uploaded = { id, name: record.name };
      $('resume-name').textContent = record.name;
      $('resume-choose').textContent = 'Choose a different PDF…';
      $('fill').disabled = false;
      setStatus('');
    } catch (err) {
      setStatus('Couldn’t use that file: ' + (err.message || err));
    }
  });

  $('fill').addEventListener('click', () => {
    const wantFolder = $('save-folder').checked;
    const permission = wantFolder ? askForDownloads() : Promise.resolve(false);
    permission.then(async (granted) => {
      const btn = $('fill');
      btn.disabled = true;
      try {
        let savedTo = '';
        if (wantFolder && granted) {
          try {
            await saveDescription();
            await saveResume();
            savedTo = folder();
          } catch (err) {
            setStatus('Couldn’t save to the folder (' + err.message + '); filling anyway…');
          }
        }
        setStatus('Filling the application…');
        const res = await chrome.runtime.sendMessage({ type: 'tailor-fill', sid, tailoredId: uploaded.id, folder: savedTo });
        if (!res || !res.ok) return setStatus('Filling failed: ' + ((res && res.error) || 'unknown error'));
        const where = savedTo ? ` Saved the description and resume to Downloads/${savedTo}/.` : wantFolder ? ' (Not saved to a folder: permission wasn’t granted.)' : '';
        setStatus(`Done. Filled ${res.filled} of ${res.total} fields with ${uploaded.name} attached.${where} Review the application before you submit.`);
      } catch (err) {
        setStatus('Something went wrong: ' + (err.message || err));
      } finally {
        btn.disabled = false;
      }
    });
  });

  // ---------------------------------------------------------------------------

  async function init() {
    const key = 'tailor:' + sid;
    session = (await chrome.storage.session.get(key))[key];
    if (!session) {
      setStatus('This session expired. Go back to the job tab and open the job description again.');
      $('copy').disabled = true;
      return;
    }
    const p = session.posting;
    $('job-title').textContent = p.title || 'Job description';
    $('job-company').textContent = p.company ? p.company + ' · ' : '';
    try {
      const u = new URL(p.url);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        $('job-link').href = u.href;
        $('job-link').textContent = u.hostname + u.pathname;
      }
    } catch (e) {
      /* no link */
    }
    document.title = `Job: ${p.company || p.title || 'Description'}`;
    $('description').value = p.description.trim();
    $('folder-path').textContent = folder() + '/';
  }

  init();
})();
