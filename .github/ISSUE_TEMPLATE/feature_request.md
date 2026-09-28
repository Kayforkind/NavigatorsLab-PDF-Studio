name: Feature request
description: Suggest an idea for PDF Studio
title: "[feature]: "
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem would this solve?
      description: Who hits this, and what do they do today without it?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: What should it do?
      description: Describe the behavior you'd want
    validations:
      required: true
  - type: checkboxes
    id: privacy
    attributes:
      label: Privacy check
      description: PDF Studio is 100% client-side — no uploads, ever
      options:
        - label: This feature can work fully in the browser with no server and no uploads
