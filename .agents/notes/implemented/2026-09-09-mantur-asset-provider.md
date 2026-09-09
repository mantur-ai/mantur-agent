# Production asset provider

The Mantur asset provider reads the selected pipeline report and stores its prompt drafts, proposals, actual request fields, and media bindings as separate observations. Source updates use the filesystem generation and source fingerprint captured by the request. A journal is committed before a replacement and history retains the selected prompt fields for guarded recovery. The provider does not schedule generation or infer missing image bindings.
