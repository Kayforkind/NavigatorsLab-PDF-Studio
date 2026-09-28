name: Bug report
description: Report something broken in PDF Studio
title: "[bug]: "
labels: [bug]
body:
  - type: input
    id: version
    attributes:
      label: Version
      description: App version (see the live app footer) or the commit you built from
    validations:
      required: true
  - type: dropdown
    id: platform
    attributes:
      label: Platform
      options:
        - Desktop browser
        - Mobile browser
        - Installed PWA
        - Docker / self-hosted
    validations:
      required: true
  - type: textarea
    id: what
    attributes:
      label: What happened?
      description: What you did, what you expected, and what actually happened
    validations:
      required: true
  - type: textarea
    id: pdf
    attributes:
      label: The PDF (if shareable)
      description: If the bug involves a specific file and you can share it, attach it or describe how to reproduce it with the built-in demo document
