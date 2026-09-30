# pdf.js (vendored)

- Package: [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) 6.3.289, unmodified
- Files: `build/pdf.min.mjs`, `build/pdf.worker.min.mjs`
- License: Apache-2.0 (see `LICENSE`)
- Used only by the options page to extract text from your resume, locally. Loaded from the
  extension package, never from the network. Opened with `isEvalSupported: false`.

To update: `npm pack pdfjs-dist@<version>`, copy the two files above from `package/build/`, and
update the version here and in `options/resume-import.js`.
