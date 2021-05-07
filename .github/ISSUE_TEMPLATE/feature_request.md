---
name: 💡 Feature or improvement request
about: Add a feature or improvement request
title: ''
labels: 'evaluation needed'
assignees: ''

---

## 1. Background & description

*Why?*

Requirement source: [internal/customer/other external + link to the original source if one exists]

Describe here
- The need for the feature (initiated from external/internal request)
- The goal of the feature

## 2. Requirements

*What?*

#### Functional requirements

Prerequisites
End results
Other functional requirements
Error situations

#### Performance requirements

Memory usage
Time of the operation
Simultaneous users

#### Usability requirements

Intended users and their skills
Instructions for use
Browser/mobile
Accessibility

#### Risk analysis

*Instructions: 1. Identify risks that may arise due to this issue. 2. Check the product's existing risks and how they may appear in this issue. 3. Describe how each risk is taken into account in this issue. If new risks or risk controls are identified, invite a risk workshop to discuss these.*

- [ ] Risk analysis done and risks updated according to QMS

Identified risks (mark potential new ones by bolding them):
1. [Description]
2. [Description]

Related risks from the risk list:
1. [Identifier, description]
2. [Identifier, description]

Control and actions (all risks from previous lists):
1. [Risk, controls, actions]
2. [Risk, controls, actions]

## 3. Implementation

*How?*

Describe here
- Architectural decisions
- Which other products or product components does this feature use?
- Which external libraries etc. does this feature use?

#### Security check-up

Check that the OWASP top 10 have been taken into account.

[https://github.com/OWASP/www-project-top-ten/blob/master/index.md](https://github.com/OWASP/www-project-top-ten/blob/master/index.md)
- [ ] **1 Injection** - [comments]
- [ ] **2 Broken Authentication** - [comments]
- [ ] **3 Sensitive Data Exposure** - [comments]
- [ ] **4 XML External Entities (XXE)** - [comments]
- [ ] **5 Broken Access Control** - [comments]
- [ ] **6 Security Misconfiguration** - [comments]
- [ ] **7 Cross-Site Scripting XSS** - [comments]
- [ ] **8 Insecure Deserialization** - [comments]
- [ ] **9 Using Components with Known Vulnerabilities** - [comments]
- [ ] **10 Insufficient Logging & Monitoring** - [comments]

## 4. Verification

General description of how to test the feature
- Functionality
- Performance
- Usability
- Automatically or manually

To be verifified by the following cases:

1. [Test case 1]
2. [Test case 2]

Verification results:

- [ ] 1. Pass/Fail (SW version, date, verifier)
- [ ] 2. Pass/Fail (SW version, date, verifier)
