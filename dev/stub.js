// Test harness: fake chrome.storage with a fake profile, then load the real extension scripts.
(function () {
  const store = {
    profile: {
      firstName: 'Testy', lastName: 'McTestface', email: 'testy.mctestface@example.com', phone: '(916) 555-0100',
      address: '123 Example St', city: 'Sacramento', state: 'CA', zip: '95819', country: 'United States',
      linkedin: 'https://www.linkedin.com/in/testy-example', github: 'https://github.com/testy-example', portfolio: 'https://example.com',
      workAuthorized: 'yes', requiresSponsorship: 'no', willingToRelocate: 'yes',
      gender: 'Decline to answer', race: 'Decline to answer', veteran: 'I am not a protected veteran', disability: 'Decline to answer',
      workHistory: [
        { employer: 'Example Corp', title: 'Software Engineering Intern', location: 'Sacramento, CA', startDate: '2025-06', endDate: '', current: true, supervisorName: 'Pat Example', supervisorPhone: '(916) 555-0101', description: 'Built internal tools.' },
        { employer: 'Campus IT', title: 'Student Assistant', location: 'Sacramento, CA', startDate: '2023-09', endDate: '2025-05', current: false, supervisorName: '', supervisorPhone: '', description: 'Help desk.' },
      ],
      education: [{ school: 'California State University, Sacramento', degree: 'BS', major: 'Computer Science', gpa: '3.5', location: 'Sacramento, CA', startDate: '2022-08', gradDate: '2026-05' }],
      customAnswers: [{ question: 'How did you hear about us?', answer: 'Company website' }],
    },
    resume: { name: 'Testy_McTestface_Resume.pdf', type: 'application/pdf', size: 300,
      data: btoa('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
      savedAt: new Date().toISOString() },
  };
  window.chrome = window.chrome || {};
  // get(null) returns everything, like the real API; onChanged is a no-op (nothing else writes).
  window.chrome.storage = {
    local: { get: async (k) => (k === null ? { ...store } : { [k]: store[k] }), set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } },
    onChanged: { addListener() {} },
  };
})();
