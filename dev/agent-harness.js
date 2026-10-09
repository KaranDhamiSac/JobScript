// Test harness for agent mode on a mock page: stands in for background.js, so the real panel,
// content/agent.js and lib/agent.js run together without the extension or an API key.
// Load it after the fake chrome.storage and lib/ai.js + lib/agent.js, before the content scripts.
//
// Claude is scripted: set window.__fakeClaude = (body, step) => [content blocks], where body is
// the request lib/agent.js sent (read body.messages for the latest snapshot or tool results).
// Every request is kept in window.__agentRequests; tool calls and results in window.__agentTrace.
(function () {
  const listeners = [];
  window.__agentRequests = [];
  window.__agentTrace = [];
  let current = null;

  window.chrome.runtime = {
    id: 'jobscript-test',
    onMessage: { addListener: (fn) => listeners.push(fn) },
    sendMessage: async (msg) => {
      if (msg.type === 'agent-start') return start(msg);
      if (msg.type === 'agent-stop') {
        if (current && current.runId === msg.runId) current.controller.abort();
        return { ok: true };
      }
      return { ok: false, error: 'Not available in the harness.' };
    },
  };

  // Like chrome.tabs.sendMessage to the frame: the content script's listener answers.
  function toPage(message) {
    return new Promise((resolve) => {
      let answered = false;
      for (const fn of listeners) {
        const keep = fn(message, { id: 'jobscript-test' }, (r) => {
          answered = true;
          resolve(r);
        });
        if (keep === true) return;
      }
      if (!answered) resolve(undefined);
    });
  }

  // The fake Messages API.
  const realFetch = window.fetch;
  let step = 0;
  window.fetch = async (url, opts) => {
    if (!String(url).includes('api.anthropic.com')) return realFetch(url, opts);
    const body = JSON.parse(opts.body);
    window.__agentRequests.push(body);
    if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 150));
    const content = (window.__fakeClaude || (() => [{ type: 'tool_use', id: 'done', name: 'done', input: { summary: 'Nothing scripted.' } }]))(body, step++);
    const usage = { input_tokens: 150, output_tokens: 120, cache_creation_input_tokens: step === 1 ? 2400 : 300, cache_read_input_tokens: step === 1 ? 0 : 2400 + step * 300 };
    const data = { model: body.model, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', content, usage };
    return { ok: true, status: 200, json: async () => data };
  };

  async function start(msg) {
    if (current) return { ok: false, error: 'The agent is already running in this tab.' };
    step = 0;
    const run = { runId: msg.runId, controller: new AbortController() };
    current = run;
    const send = (m) => toPage(Object.assign({ runId: run.runId }, m));
    const host = location.hostname;
    const profile = (await window.chrome.storage.local.get('profile')).profile;
    window.JobScriptAgent.run({
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      signal: run.controller.signal,
      profile: window.JobScriptStorage.withDefaults(profile),
      canonAnswers: {},
      canonical: window.JobScriptCanonical.QUESTIONS.map((q) => ({ key: q.key, label: q.label })),
      job: { title: msg.job.jobTitle, company: msg.job.company, description: msg.job.jobDescription },
      snapshot: msg.snapshot,
      screenshots: false,
      execute: async (name, input) => {
        const res = await send({ type: 'agent-tool', name, input });
        window.__agentTrace.push({ name, input, res });
        if (!res) return { text: 'No answer.', isError: true, stop: 'The page stopped responding.' };
        if (res.stopped) return Object.assign({}, res, { stop: 'Stopped by you.' });
        if (res.url && new URL(res.url).hostname !== host) return { text: 'Left the site.', isError: true, stop: `The page left ${host}, so the agent stopped.` };
        return res;
      },
      onEvent: (e) => send(Object.assign({ type: 'agent-event' }, e)),
    }).then((res) => {
      current = null;
      window.__agentResult = res;
      send({ type: 'agent-event', usage: res.usageText, end: res.ok ? 'Done. ' + res.summary : res.error, isError: !res.ok && !res.stopped });
    });
    return { ok: true, model: 'Claude Sonnet 5.5 (test)' };
  }
})();
