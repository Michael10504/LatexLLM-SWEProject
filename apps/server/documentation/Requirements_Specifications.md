Local LaTeX Project Proposal

Requirements Specifications

*CSCE3701 \- Software Engineering*

**Project Overview:**

We propose a LaTeX editor for academic and long-form writing that combines three things: (1) fast LaTeX editing and compilation, (2) a side panel of AI writing tools that can run on a local LLM (private) or an API model (higher quality), and (3) sharing and collaboration between contributors through login credentials. The product serves mainly two profiles. Researchers need privacy and strong refinement, so they rely on local models. Undergraduate students and writers need many contributors on one document, and they mostly use API models. The design must support both from the start.

**Stakeholders**

Stakeholder classes and their representatives:

1\. Researchers

Representative: a PhD researcher (Dr. Laila) writing papers that contain unpublished data.

Main needs: literature review support, a more academic tone, paper outlines, manuscript refinement.

Top priority: high-quality refinement and strict data privacy.

Preferred AI mode: local LLM (a necessity).

2\. Undergraduate students

Representative: a third-year student (Omar) writing group assignments and reports.

Main needs: help with assignments, grammar, LaTeX errors and captions, group work on shared documents.

Top priority: many contributors on one project, and ease of use.

Preferred AI mode: API models.

3\. Writers

Representative: an author (Nour) drafting a long text with two co-writers.

Main needs: drafting and refining long texts, co-writing with others.

Top priority: many contributors on one project.

Preferred AI mode: API models.

**Secondary stakeholders:**

4\. Supervisors and instructors

Representative: Prof. Karim, a university supervisor who reviews student reports and theses.

Main needs: open student documents without editing them, give feedback on specific passages, see who contributed what, and check progress over time.

Top priority: easy read-only access and clear feedback tools.

Preferred AI mode: not a direct AI user. Cares about transparency when AI was used.

5\. Developers

Representative: Sara, a developer who maintains the system after release.

Main needs: add or swap AI models, keep the system secure and stable, test and deploy changes easily and understand the code quickly.

Top priority: maintainability and sustainability of the system.

Preferred AI mode: any. Needs a common model interface so models can be swapped.

**Stakeholders Scenarios**

**Scenario B, Student (Omar):**

Omar opens the group report in the browser and invites two teammates as editors. All three edit the same file. Omar’s table fails to compile, so he clicks “Fix LaTeX”, reads the plain-language explanation, and accepts the fix. He asks the AI for a caption for his figure and picks a stronger API model to improve the introduction. He then runs grammar correction before submitting.

**Scenario C, Writer (Nour)**

Nour shares her book draft with an editor (editor role) and a friend (viewer role). While drafting, she selects a chapter section and asks the AI to refine clarity and flow. A co-writer accidentally deletes a paragraph, so Nour opens the version history and restores the earlier version.

**Scenario D, Supervisor (Prof. Karim)**

Omar’s team shares their group report with Prof. Karim using a share link with the viewer role. Prof. Karim opens it in the browser without creating extra work for the students. He reads the compiled PDF beside the source and cannot change any text. He selects an unclear paragraph and leaves a comment asking for a source. He then opens the version history to see which team member wrote which sections and when. The students receive his comment, fix the paragraph, and he marks the comment as resolved.

**Scenario E, Developer (Sara)**

A new, better local model is released. Sara writes a new adapter for it behind the common model interface, without touching the editor UI. She pushes her change, and the automated tests run and pass. She deploys the update to the server with a single command. After deployment, she checks the system logs for errors and confirms that no document text or API keys appear in them.

Product Backlog:

**Requirements Specification:**

**Verification codes: T \= test, D \= demonstration, I \= inspection, A \= analysis.**

**1 External interface requirements**

● **User interfaces.** A single window with a source editor, PDF preview pane, compile log pane, AI panel with a diff view, and dialogs for consent, conflicts, sharing, and settings. A visible indicator shows whether Local Only mode is on (FR-06.5).

● **Hardware interfaces.** An NVIDIA-class GPU with 4 GB of VRAM is the minimum for the local AI tasks (section 3.3).

● **Software interfaces.** A local language-model runtime reached over loopback; a container runtime for the compile sandbox; the project server API over TLS; the cloud summarization service API over TLS.

● **Communications interfaces.** All external communication uses TLS 1.2 or higher (NFR-08). Local components communicate over loopback only.

**2 Functional requirements**

**2.1 Project management (FR-01) — Must**

● **FR-01.1** WHEN an authenticated user submits a project name (1 to 100 characters, unique among that user's projects), THEN the system shall create a project containing one main .tex file and shall assign that user the Owner role. \[T\]

● **FR-01.2** The system shall let a user with edit permission add, rename, delete, and open files of types .tex, .bib, .sty, .png, .jpg, and .pdf within a project, up to 500 files and 100 MB per project. \[T\]

● **FR-01.3** WHEN a user with edit permission triggers a manual save, THEN the system shall write the current content of all modified files to the project immediately. \[T\]

● **FR-01.4** WHEN the Owner confirms a deletion dialog, THEN the system shall permanently delete the project with its version history and sharing links. \[T\]

● **FR-01.5** The system shall list all projects the user owns or that were shared with the user, with their roles. \[D\]

● **FR-01.6** IF a user attempts an action that the user's role does not permit (section 2.3), THEN the system shall refuse it and display an explanatory message. The server shall enforce this independently of the client. \[T\]

● **FR-01.7** The editor shall highlight LaTeX syntax. (Should) \[D\]

**2.2 Compilation and preview (FR-02) — Must**

● **FR-02.1** WHEN the user requests compilation, THEN the system shall compile the project's main file inside a sandbox container and, on success, display the resulting PDF in the preview pane. \[T\]

● **FR-02.2** WHEN compilation produces errors or warnings, THEN the system shall list them in the compile log. WHEN an entry that carries a file name and line number is clicked, THEN the system shall open that file and place the cursor on that line. \[T\]

● **FR-02.3** IF compilation fails, THEN the system shall keep showing the last successful PDF marked as outdated. \[T\]

● **FR-02.4** The sandbox container shall run with shell-escape disabled, no network access, access only to the project directory, and limits of 2 CPU cores, 2 GB of RAM, 500 MB of disk, and 60 seconds of wall-clock time. \[T, I\]

● **FR-02.5** IF compilation exceeds 60 seconds, THEN the system shall terminate it and report a timeout error. \[T\]

● **FR-02.6** WHEN the user requests compilation while another compilation of the same project is running, THEN the system shall cancel the running one and start the new one. \[T\]

**2.3 Local AI processing (FR-03) — Must**

● **FR-03.1** The system shall provide exactly these eight local AI tasks: (1) organize notes, (2) write a section outline, (3) rewrite for clarity, (4) adjust academic tone, (5) check grammar, (6) insert a table, (7) write a figure caption, (8) fix LaTeX syntax. \[D\]

● **FR-03.2** WHEN the user runs task 1 to 7 with text selected, THEN the system shall use the selected text as input. Task 6 shall produce a LaTeX table from the selected text; task 7 shall produce a caption for the selected figure environment or description. IF no text is selected, THEN the system shall ask the user to select text and shall not run the model. \[T\]

● **FR-03.3** WHEN the user runs task 8, THEN the system shall use the most recent compile log, with or without a text selection, and shall propose a fix for the first reported error. IF no compile log exists, THEN the system shall ask the user to compile first. IF the log contains no errors, THEN the system shall report that no errors were found and shall not run the model. \[T\]

● **FR-03.4** The system shall execute every local AI task on the user's device and shall never send the input or output of a local AI task to any external destination, regardless of Local Only mode. \[T, I\]

● **FR-03.5** IF the selected input exceeds 1,000 words, THEN the system shall reject the task with a message asking for a smaller selection. \[T\]

● **FR-03.6** WHILE a local AI task runs, the system shall stream its output and show a Cancel control. WHEN the user cancels, THEN the system shall discard the partial output and leave the document unchanged. (Should) \[T\]

● **FR-03.7** IF the model is unavailable or fails, THEN the system shall display an error and leave the document unchanged. \[T\]

**2.4 AI output verification (FR-04) — Must**

● **FR-04.1** WHEN a local AI task returns a result, THEN the system shall display it as a diff against the original text (insertions are shown as pure additions) and shall leave the document unchanged. \[T\]

● **FR-04.2** The diff view shall offer Accept all, Reject all, and accept or reject for each hunk. WHEN the user accepts, THEN the system shall apply the accepted hunks as one undoable edit. \[T\]

● **FR-04.3** IF the source text changed after the diff was generated, THEN the system shall disable acceptance and tell the user to rerun the task. \[T\]

● **FR-04.4** The system shall not modify document text as a result of AI output except through FR-04.2 (zero silent edits). \[T, I\]

**2.5 Cloud summarization (FR-05) — Must**

● **FR-05.1** WHEN the user selects a PDF for summarization, THEN the system shall verify that it is a valid PDF of at most 20 MB and 100 pages. IF it is not, THEN the system shall display an error and transmit nothing. \[T\]

● **FR-05.2** IF Local Only mode is off AND a valid PDF is selected, THEN the system shall display a modal consent dialog showing the file name, file size, the name of the cloud provider, and a statement that the whole file will be sent to a third party. The system shall transmit nothing until the user clicks Send, and consent shall apply to that one request only. \[T\]

● **FR-05.3** WHEN the user clicks Cancel or closes the dialog, THEN the system shall transmit nothing. \[T\]

● **FR-05.4** The system shall send user content to a cloud service only for summarization of an uploaded PDF, and no other function shall do so. \[T, I\]

● **FR-05.5** WHEN the summary is returned, THEN the system shall show it in a read-only panel and shall not insert it into any source file except through FR-04. \[T\]

● **FR-05.6** IF the cloud service is unreachable, returns an error, or does not answer within 60 seconds, THEN the system shall display an error with a Retry option. \[T\]

● **FR-05.7** IF Local Only mode is on AND the user requests cloud summarization, THEN the system shall display an error popup stating that Local Only mode must be disabled first, shall show no consent dialog, and shall transmit nothing. \[T\]

● **FR-05.8** The system shall not store the transmitted PDF on the project server. (Should) \[I\]

**2.6 Privacy controls (FR-06) — Must**

● **FR-06.1** The system shall provide one global Local Only setting that applies to all projects on the device, is reachable from the login screen and the main window, and is persisted across restarts. \[D\]

● **FR-06.2** WHEN Local Only mode is enabled, THEN the system shall initiate no connection to any external destination and shall abort any in-flight external request within 1 second. \[T\]

● **FR-06.3** WHILE Local Only mode is enabled, the system shall block cloud summarization (FR-05.7), repository synchronization (FR-11), and the creation and management of sharing links (FR-09). Each attempt shall display a message that the function is unavailable in Local Only mode. \[T\]

● **FR-06.4** WHILE Local Only mode is enabled, editing, compilation, local AI tasks, and version history shall remain fully functional. \[T\]

● **FR-06.5** The system shall display a persistent indicator of the Local Only state. \[D\]

● **FR-06.6** WHEN Local Only mode is disabled, THEN the system shall re-enable the blocked functions and shall not replay any request made while it was enabled. \[T\]

● **FR-06.7** IF the session has expired while Local Only is enabled, THEN the system shall tell the user that logging in requires disabling Local Only mode (assumption A-5). \[T\]

**2.7 Authentication and accounts (FR-07) — Must**

● **FR-07.1** WHEN a visitor submits a username (3 to 32 characters) that is not yet registered and a password that meets FR-07.2, THEN the system shall create the account. IF the username exists, THEN the system shall reject the registration with a message. \[T\]

● **FR-07.2** The system shall require passwords of at least 8 characters, shall accept passwords up to at least 64 characters, shall reject passwords on a list of the 10,000 most common passwords, and shall store passwords only as salted, adaptive hashes. \[T, I\]

● **FR-07.3** WHEN a user submits a valid username and password, THEN the system shall start an authenticated session. IF either is wrong, THEN the system shall display one generic message that does not reveal which was wrong. \[T\]

● **FR-07.4** IF five consecutive login attempts for one username fail within 15 minutes, THEN the system shall reject all login attempts for that username for 15 minutes. \[T\]

● **FR-07.5** The system shall end a session after 8 hours of inactivity or when the user logs out. \[T\]

**2.8 Version control (FR-08) — Should**

● **FR-08.1** The system shall record a version of a document (a) on each manual save, (b) after 5 minutes without edits while unrecorded changes exist, and (c) when the document is closed with unrecorded changes. Autosave shall not record versions. \[T\]

● **FR-08.2** IF a document has not changed since its last recorded version, THEN the system shall not record a new version. \[T\]

● **FR-08.3** The system shall list versions with timestamp, author, and trigger (manual save, inactivity, or close). \[D\]

● **FR-08.4** WHEN an Owner or Editor confirms the restoration of a version, THEN the system shall replace the document content with that version and record the restored content as a new version. \[T\]

● **FR-08.5** The system shall retain at least the 100 most recent versions per document. \[T\]

**2.9 Collaboration and sharing (FR-09) — Should**

● **FR-09.1** WHEN the Owner creates a sharing link and selects the role Editor or Viewer, THEN the system shall generate a link containing an unguessable token of at least 128 bits. \[T, I\]

● **FR-09.2** IF a user who is not authenticated opens a sharing link, THEN the system shall deny access and show the login screen. WHEN a registered user is authenticated and opens a valid link, THEN the system shall add the project to that user's project list with the link's role. \[T\]

● **FR-09.3** The Owner shall be able to set a link expiry (default 7 days, maximum 90 days) and to revoke a link. After expiry or revocation, the system shall deny any further use of the link. Users who already joined keep their role until the Owner changes or removes it. \[T\]

● **FR-09.4** The Owner shall be able to change or remove the role of any collaborator. Only the Owner may assign roles. \[T\]

● **FR-09.5** The system shall not provide real-time co-editing. Editors shall combine changes through synchronization, with conflicts handled by FR-11.4. \[I\]

● **FR-09.6** The server shall reject any content change from a Viewer. \[T\]

**2.10 Repository synchronization (FR-10) — Should**

● **FR-10.1** WHEN a user with any role selects a server project and chooses Download, THEN the system shall create a complete local copy of the project. \[T\]

● **FR-10.2** WHEN a user chooses Sync or Pull, THEN the system shall fetch remote changes and merge them into the local copy. \[T\]

● **FR-10.3** WHEN an Owner or Editor chooses Push AND the local copy is up to date, THEN the system shall upload the local changes. IF the local copy is outdated, THEN the system shall reject the push and ask the user to pull first. IF a Viewer attempts a push, THEN the server shall reject it. \[T\]

● **FR-10.4** WHEN a merge conflict occurs, THEN the system shall list the conflicting files, show the local and remote text side by side, and let the user choose the local text, the remote text, or an edited text. The system shall not push until all conflicts are resolved. \[T\]

● **FR-10.5** All synchronization operations shall be available through the graphical interface without typing any command. \[D\]

● **FR-10.6** IF the connection is lost during synchronization, THEN the system shall abort the operation and leave the local copy and server copy in a consistent state. \[T\]

● **FR-10.7** The system shall exclude compilation outputs (.aux, .log, and generated .pdf files) from synchronization. \[T\]

**3 Non-functional requirements**

**Reference configuration (RC):** 4-core CPU at 3 GHz or faster, 16 GB RAM, SSD storage, NVIDIA GPU with 4 GB VRAM, a 50 Mbit/s internet connection, and the local model described in A-6. "Standard host load" means no other significant application running during measurement. Performance targets are verified on the RC, with at least 20 runs, using the stated percentile.

● **NFR-01 (Usability)** WHEN the user runs any local AI task, THEN the system shall allow completing it in at most three mouse clicks: selecting text (counted as one click), clicking the task control, and clicking Accept all. Task 8 (fix LaTeX) shall need at most two clicks (task control and Accept all), because it needs no selection. Cloud summarization is excluded. Verification: scripted UI interaction test for each task. Must. \[T\]

● **NFR-02 (Reliability)** The system shall autosave the working copy of every open document to local storage every 60 seconds (plus or minus 5 seconds), excluding unaccepted AI results and without creating versions. After an abnormal termination, the system shall restore a working copy that is at most 60 seconds old. Must. \[T\]

● **NFR-03 (Performance, compile)** On the RC, a complete build of a 5,000-word document with 10 figures (each at most 1 MB) shall finish in at most 10.0 seconds at the 95th percentile, measured from compile request to PDF display with the sandbox already running. Starting a stopped sandbox shall take at most 20 seconds. Must. \[T\]

● **NFR-04 (Performance, local AI)** On the RC, with the model loaded, the first output token shall appear within 3.0 seconds (95th percentile), the output rate shall be at least 20 tokens per second (median), and rewriting a 150-word paragraph shall complete within 15.0 seconds (95th percentile). If the model must be loaded first, the first token shall appear within 20 seconds and a progress indicator shall be shown. Must. \[T\]

● **NFR-05 (Privacy)** WHILE Local Only mode is enabled, the application shall make zero connections to external destinations, including DNS lookups, update checks, and telemetry. Verification: run all functions of the client for at least 30 minutes while capturing the application's traffic and confirm that no packet goes to a non-loopback address. Must. \[T\]

● **NFR-06 (Resource use)** While running any local AI task on the RC, the peak GPU memory used by the local AI module shall not exceed 3.0 GB (75% of 4 GB), with a context window of at most 4,096 tokens. Must. \[T\]

● **NFR-07 (Output quality)** On a test set of 30 prompts per local AI task type (20 papers for cloud summarization), at least 80% of outputs shall be rated "usable with at most minor edits" by both of two reviewers. "Minor edits" means changing at most 10% of the output words without changing its meaning; for task 8, the corrected source must compile without the reported error. Must. \[T\]

● **NFR-08 (Security)** All external communication shall use TLS 1.2 or higher. Provider credentials shall be stored encrypted and shall never appear in logs or the user interface. The compile sandbox shall meet FR-02.4. Must. \[T, I\]

● **NFR-09 (Availability)** The server functions (login, sharing, synchronization) shall be available at least 99.0% of each month, excluding maintenance announced at least 24 hours in advance. Local functions have no server dependency. Should. \[A\]

**Use Cases:**

This document describes the system's use cases as fully dressed textual specifications in the style of Cockburn and UML.

**1 Actors**

| Actor | Kind | Description |
| :---- | :---- | :---- |
| User | Abstract primary | Any person using the client application. |
| Visitor | Primary | A User without an account. Specializes User. |
| Registered User | Primary | A person who holds an account. Specializes User. |
| Viewer | Primary | A Registered User with the Viewer role in a project. Specializes Registered User. |
| Editor | Primary | A Viewer who may also edit the project. Specializes Viewer. |
| Owner | Primary | An Editor who created the project and manages it. Specializes Editor. |
| System Timer | Secondary (time trigger) | Starts time-based behaviour: autosave and inactivity versioning. |
| Cloud Summarization Service | Secondary (external system) | Third-party service that summarizes an uploaded PDF. |

**2 Use case catalog**

| ID | Use case | Primary actor | Relationships | SRS reference |
| :---- | :---- | :---- | :---- | :---- |
| UC-01 | Register Account | Visitor |  | FR-07.1, 07.2 |
| UC-02 | Log In | Registered User |  | FR-07.3 to 07.5 |
| UC-03 | Log Out | Registered User |  | FR-07.5 |
| UC-04 | Toggle Local Only Mode | User |  | FR-06.1 to 06.6, NFR-05 |
| UC-05 | Create Project | Registered User |  | FR-01.1 |
| UC-06 | Open Project | Registered User | extended by UC-21 | FR-01.5, 01.6 |
| UC-07 | Manage Project Files | Editor |  | FR-01.2, 01.6 |
| UC-08 | Edit and Save Document | Editor | includes UC-17 | FR-01.3, 01.7 |
| UC-09 | Delete Project | Owner |  | FR-01.4 |
| UC-10 | Compile Project | Viewer | extended by UC-11 | FR-02.1, 02.3 to 02.6 |
| UC-11 | Navigate to Error from Compile Log | Viewer | extends UC-10 | FR-02.2 |
| UC-12 | Run Local AI Task | Editor | includes UC-14 | FR-03.1, 03.2, 03.4 to 03.7 |
| UC-13 | Fix LaTeX Syntax | Editor | includes UC-14 | FR-03.3 |
| UC-14 | Review AI Diff | Editor | included by UC-12, UC-13 | FR-04.1 to 04.4 |
| UC-15 | Summarize Research Paper | Registered User | includes UC-16; secondary: Cloud Summarization Service | FR-05.1, 05.4 to 05.8 |
| UC-16 | Confirm Cloud Transmission | Registered User | included by UC-15 | FR-05.2, 05.3 |
| UC-17 | Record Version | System Timer | included by UC-08 | FR-08.1, 08.2, 08.5 |
| UC-18 | View Version History | Viewer | included by UC-19 | FR-08.3 |
| UC-19 | Restore Version | Editor | includes UC-18 | FR-08.4 |
| UC-20 | Autosave Working Copy | System Timer |  | NFR-02 |
| UC-21 | Recover Working Copy | Editor | extends UC-06 | NFR-02 |
| UC-22 | Manage Sharing Links | Owner |  | FR-09.1, 09.3 |
| UC-23 | Join Project via Sharing Link | Registered User | includes UC-02 | FR-09.2 |
| UC-24 | Manage Collaborators | Owner |  | FR-09.4, 09.6 |
| UC-25 | Clone Project | Viewer |  | FR-11.1, 11.5, 11.6 |
| UC-26 | Pull Changes | Viewer | extended by UC-28 | FR-11.2, 11.5 to 11.7 |
| UC-27 | Push Changes | Editor |  | FR-11.3, 11.6 |
| UC-28 | Resolve Merge Conflict | Editor | extends UC-26 | FR-11.4 |

**3 Use case Specification**

**3.1 Accounts and privacy settings**

**UC-01 Register Account**

**Primary actor:** Visitor · **Priority:** Must · **SRS:** FR-07.1, FR-07.2 **Goal:** Obtain an account.

**Preconditions:** The client is running, Local Only mode is disabled, and the server is reachable.

**Trigger:** The Visitor selects Register.

**Main success scenario**

1\. The Visitor enters a username (3 to 32 characters) and a password.

2\. The system checks that the username is unused and that the password meets the policy (at least 8 characters, not on the common-password list).

3\. The system stores the account with a salted, adaptive password hash.

4\. The system confirms the registration and shows the login screen.

**Alternative and exception flows**

● **2a.** The username is taken: the system rejects it and asks for another; return to step 1\.

● **2b.** The password breaks the policy: the system names the rule; return to step 1\.

● **\*a.** Local Only mode is enabled: the system says registration needs Local Only mode to be disabled, and the use case ends.

● **\*b.** The server is unreachable: the system shows an error and no account is created.

**Postconditions:** Success: the account exists and no session is started. Failure: no account is created.

**UC-02 Log In**

**Primary actor:** Registered User · **Priority:** Must · **SRS:** FR-07.3 to FR-07.5 **Goal:** Start an authenticated session. **Preconditions:** The account exists and no session is active. **Trigger:** The user opens the login screen.

**Main success scenario**

1\. The user enters username and password.

2\. The system verifies them against the server.

3\. The system starts a session that expires after 8 hours of inactivity.

4\. The system shows the project list (UC-06).

**Alternative and exception flows**

● **2a.** The credentials are wrong: the system shows one generic message that does not say which was wrong; return to step 1\.

● **2b.** Five consecutive attempts for the username fail within 15 minutes: the system rejects all further attempts for that username for 15 minutes and says so.

● **\*a.** Local Only mode is enabled: the system says logging in requires disabling Local Only mode (SRS FR-06.7).

● **\*b.** The server is unreachable: the system shows an error and no session is started.

**Postconditions:** Success: an authenticated session exists. Failure: no session exists.

**UC-03 Log Out**

**Primary actor:** Registered User · **Priority:** Must · **SRS:** FR-07.5 **Goal:** End the session.

**Preconditions:** A session is active. **Trigger:** The user selects Log out, or the session expires after 8 hours of inactivity.

**Main success scenario**

1\. The user selects Log out.

2\. The system ends the session.

3\. The system returns to the login screen.

**Alternative and exception flows**

● **1a.** Unsaved changes exist: the system asks the user to save (UC-08) or discard them before ending the session.

● **1b.** The session expired by inactivity: the system performs steps 2 and 3 without a prompt.

**Postconditions:** No session exists.

**UC-04 Toggle Local Only Mode**

**Primary actor:** User · **Priority:** Must · **SRS:** FR-06.1 to FR-06.6, NFR-05 **Goal:** Switch the global Local Only privacy mode on or off. **Preconditions:** The client is running. Login is not required, because the toggle is reachable from the login screen. **Trigger:** The user opens the settings or uses the login-screen toggle.

**Main success scenario (enabling)**

1\. The user enables Local Only mode.

2\. The system aborts any in-flight external request within 1 second.

3\. The system blocks registration, login, cloud summarization, sharing, and synchronization (UC-01, 02, 15, 22 to 27).

4\. The system shows a persistent Local Only indicator.

5\. The system saves the setting so it persists across restarts.

**Alternative and exception flows**

● **1a.** The user disables Local Only mode: the system re-enables the blocked functions, removes the indicator, and does not replay any request made while the mode was on.

● **2a.** The aborted request was a synchronization: the system leaves the local and server copies consistent (FR-11.6) and tells the user it was cancelled.

**Postconditions:** The mode is stored. While it is on, no connection to any external destination is made. Editing, compilation, local AI tasks, and version history keep working.

**3.2 Projects**

**UC-05 Create Project**

**Primary actor:** Registered User (becomes Owner) · **Priority:** Must · **SRS:** FR-01.1 **Goal:** Start a new LaTeX project. **Preconditions:** The user is authenticated. **Trigger:** The user selects New project.

**Main success scenario**

1\. The user enters a project name (1 to 100 characters).

2\. The system checks that the name is unique among the user's projects.

3\. The system creates the project with one main .tex file.

4\. The system assigns the user the Owner role.

5\. The system opens the project (UC-06).

**Alternative and exception flows**

● **2a.** The name is empty, too long, or already used: the system explains the problem; return to step 1\.

**Postconditions:** The project exists and the user is its Owner.

**UC-06 Open Project**

**Primary actor:** Registered User · **Priority:** Must · **SRS:** FR-01.5, FR-01.6 **Goal:** Work on an existing project. **Preconditions:** The user is authenticated. **Trigger:** The user opens the project list. **Extension point:** abnormal termination detected (UC-21).

**Main success scenario**

1\. The system lists the projects the user owns or that were shared with the user, with their roles.

2\. The user selects a project.

3\. The system opens it with the editor, preview pane, and compile log, enabling only the actions the user's role allows.

**Alternative and exception flows**

● **1a.** There are no projects: the system shows an empty-state message offering to create a project (UC-05) or join one (UC-23).

● **2a.** The selected project exists only on the server: the system offers to download it (UC-25).

● **3a.** The previous session ended abnormally: UC-21 extends this use case.

**Postconditions:** The project is open with role-appropriate permissions.

**UC-07 Manage Project Files**

**Primary actor:** Editor · **Priority:** Must · **SRS:** FR-01.2, FR-01.6 **Goal:** Add, rename, or delete files in a project. **Preconditions:** The project is open and the user is an Editor or Owner.

**Trigger:** The user chooses to add, rename, or delete a file.

**Main success scenario**

1\. The user chooses an operation and provides a file or a new name.

2\. The system checks the file type (.tex, .bib, .sty, .png, .jpg, .pdf) and the project limits (500 files, 100 MB).

3\. The system performs the operation.

4\. The system updates the file tree.

**Alternative and exception flows**

● **1a.** The user is a Viewer: the system refuses the operation and shows an explanatory message.

● **1b.** The operation is a deletion: the system asks for confirmation first; if declined, nothing changes.

● **2a.** The type is unsupported or a limit would be exceeded: the system rejects the operation and states the reason.

● **2b.** The name already exists: the system asks for another name; return to step 1\.

**Postconditions:** The file tree reflects the change.

**UC-08 Edit and Save Document**

**Primary actor:** Editor · **Priority:** Must · **SRS:** FR-01.3, FR-01.7, FR-08.1 **Goal:** Change LaTeX source and save it. **Preconditions:** A project is open and the user is an Editor or Owner.

**Trigger:** The user edits a file.

**Main success scenario**

1\. The user edits a file in the editor, which highlights LaTeX syntax.

2\. The user triggers a manual save.

3\. The system writes all modified files to the project.

4\. The system records a version («include» UC-17).

5\. The system confirms the save.

**Alternative and exception flows**

● **1a.** The user closes a document with unrecorded changes: the system records a version (UC-17, trigger c).

● **3a.** The write fails (for example, disk full): the system shows an error, keeps the changes in the editor, and records no version.

**Postconditions:** Success: the files are saved and a version exists. Failure: the changes stay unsaved in the editor.

**UC-09 Delete Project**

**Primary actor:** Owner · **Priority:** Must · **SRS:** FR-01.4 **Goal:** Permanently remove a project.

**Preconditions:** The user is the Owner of the project. **Trigger:** The Owner selects Delete project.

**Main success scenario**

1\. The system shows a confirmation naming the project and stating that its version history and sharing links will also be deleted.

2\. The Owner confirms.

3\. The system permanently deletes the project, its versions, and its sharing links.

4\. The system returns to the project list.

**Alternative and exception flows**

● **2a.** The Owner cancels: nothing is deleted.

● **3a.** The project has a server copy and Local Only mode is enabled, or the server is unreachable: the system refuses the deletion and explains why, so no inconsistent state is left.

**Postconditions:** Success: the project no longer exists. Failure: the project is unchanged.

**3.3 Compilation**

**UC-10 Compile Project**

**Primary actor:** Viewer · **Priority:** Must · **SRS:** FR-02.1, FR-02.3 to FR-02.6, NFR-03 **Goal:** Build the PDF and see the result. **Preconditions:** A project is open. The role does not matter, because Viewers may compile. **Trigger:** The user requests compilation. **Extension point:** compile log contains entries with file and line (UC-11).

**Main success scenario**

1\. The user requests compilation.

2\. The system starts a sandbox container with no network access, shell-escape disabled, access to the project directory only, and limits of 2 CPU cores, 2 GB of RAM, 500 MB of disk, and 60 seconds.

3\. The system compiles the project's main file.

4\. The system shows the PDF in the preview pane.

5\. The system shows warnings in the compile log.

**Alternative and exception flows**

● **2a.** A compilation of the same project is running: the system cancels it and starts the new one.

● **2b.** The sandbox cannot start: the system shows an error and compiles nothing.

● **3a.** The source has errors: no new PDF is produced, the system keeps the last successful PDF marked as outdated, and shows the errors in the log.

● **3b.** Compilation exceeds 60 seconds: the system terminates it and reports a timeout error.

**Postconditions:** Success: the preview shows the new PDF. Failure: the preview shows the last successful PDF, marked outdated.

**UC-11 Navigate to Error from Compile Log**

**Primary actor:** Viewer · **Priority:** Must · **SRS:** FR-02.2 **Goal:** Jump to the source line behind a log entry. **Preconditions:** A compile log with entries exists. This use case extends UC-10 at its extension point. **Trigger:** The user clicks a log entry.

**Main success scenario**

1\. The user clicks a log entry that has a file name and line number.

2\. The system opens that file and places the cursor on that line.

**Alternative and exception flows**

● **1a.** The entry has no file or line information: the system shows it as plain text, not as a link.

● **2a.** The file no longer exists: the system shows a message and does not move the cursor.

**Postconditions:** The editor shows the referenced line.

**3.4 Local AI tasks**

**UC-12 Run Local AI Task**

**Primary actor:** Editor · **Priority:** Must · **SRS:** FR-03.1, FR-03.2, FR-03.4 to FR-03.7, NFR-01, NFR-04, NFR-06 **Goal:** Get an AI suggestion for selected text. **Preconditions:** A project is open, the user is an Editor or Owner, and the local model is available. **Trigger:** The user selects text and chooses a task. **Tasks covered:** organize notes, write a section outline, rewrite for clarity, adjust academic tone, check grammar, insert a table, write a figure caption.

**Main success scenario**

1\. The user selects text.

2\. The user chooses one of the seven tasks.

3\. The system checks that the selection has at most 1,000 words.

4\. The system runs the local model on the user's device and streams the output.

5\. The system presents the result for review («include» UC-14).

**Alternative and exception flows**

● **1a.** No text is selected: the system asks the user to select text and does not run the model.

● **3a.** The selection exceeds 1,000 words: the system rejects the task and asks for a smaller selection.

● **4a.** The user cancels: the system discards the partial output and leaves the document unchanged.

● **4b.** The model is unavailable or fails (for example, out of memory): the system shows an error and leaves the document unchanged.

**Postconditions:** The document is unchanged until the user accepts changes in UC-14. No input or output leaves the device, with or without Local Only mode.

**UC-13 Fix LaTeX Syntax**

**Primary actor:** Editor · **Priority:** Must · **SRS:** FR-03.3, FR-03.4, FR-03.6, FR-03.7 **Goal:** Get a proposed fix for a compile error. **Preconditions:** A project is open and the user is an Editor or Owner. **Trigger:** The user chooses Fix LaTeX syntax. A text selection is optional.

**Main success scenario**

1\. The user chooses Fix LaTeX syntax.

2\. The system takes the most recent compile log.

3\. The system identifies the first reported error.

4\. The system runs the local model with that error, the related source, and any selected text.

5\. The system presents the proposed fix for review («include» UC-14).

**Alternative and exception flows**

● **2a.** No compile log exists: the system asks the user to compile first (UC-10).

● **3a.** The log has no errors: the system reports that none were found and does not run the model.

● **4a.** The user cancels, or **4b.** the model fails: handled as in UC-12.

**Postconditions:** The document is unchanged until the user accepts changes in UC-14.

**UC-14 Review AI Diff**

**Primary actor:** Editor · **Priority:** Must · **SRS:** FR-04.1 to FR-04.4, NFR-01 **Goal:** Decide which AI changes enter the document. **Preconditions:** An AI result is available. Included by UC-12 and UC-13. **Trigger:** An AI task finishes.

**Main success scenario**

1\. The system shows the result as a diff against the original text (insertions appear as pure additions) and leaves the document unchanged.

2\. The user reviews the diff.

3\. The user chooses Accept all, or accepts hunks individually.

4\. The system applies the accepted hunks as one undoable edit.

5\. The system closes the diff view.

**Alternative and exception flows**

● **1a.** The source text changed after the diff was generated: the system disables acceptance and tells the user to rerun the task.

● **3a.** The user chooses Reject all, or rejects individual hunks: the rejected changes are discarded.

**Postconditions:** Only hunks the user accepted are applied. No other path changes document text (zero silent edits).

**3.5 Cloud summarization**

**UC-15 Summarize Research Paper**

**Primary actor:** Registered User · **Secondary actor:** Cloud Summarization Service · **Priority:** Must · **SRS:** FR-05.1, FR-05.4 to FR-05.8 **Goal:** Get a summary of a research paper.

**Preconditions:** The user is authenticated. **Trigger:** The user chooses Summarize paper.

**Main success scenario**

1\. The user chooses Summarize paper and selects a PDF.

2\. The system checks that the file is a valid PDF of at most 20 MB and 100 pages.

3\. The system obtains the user's consent («include» UC-16).

4\. The system sends the PDF to the Cloud Summarization Service.

5\. The service returns the summary.

6\. The system shows the summary in a read-only panel. It does not insert the summary into any source file.

**Alternative and exception flows**

● **1a.** Local Only mode is enabled: the system shows an error popup stating that Local Only mode must be disabled first. It shows no consent dialog and transmits nothing.

● **2a.** The file is invalid or too large: the system shows an error and transmits nothing.

● **3a.** The user declines consent: the use case ends and nothing is transmitted.

● **4a.** The service is unreachable, returns an error, or does not answer within 60 seconds: the system shows an error with a Retry option. A retry starts again at step 3\.

**Postconditions:** Success: the summary is displayed. The project server keeps no copy of the PDF. Failure: nothing is shown and nothing remains transmitted.

**UC-16 Confirm Cloud Transmission**

**Primary actor:** Registered User · **Priority:** Must · **SRS:** FR-05.2, FR-05.3 **Goal:** Give or refuse consent to send one file to a third party. **Preconditions:** Called from UC-15 with a valid PDF and Local Only mode disabled. **Trigger:** UC-15 reaches step 3\.

**Main success scenario**

1\. The system shows a modal dialog with the file name, the file size, the name of the cloud provider, and a statement that the whole file will be sent to a third party.

2\. The user clicks Send.

3\. The system returns the consent to UC-15.

**Alternative and exception flows**

● **2a.** The user clicks Cancel or closes the dialog: the system returns a refusal and transmits nothing.

**Postconditions:** Consent applies to this single request only.

**3.6 Version history and autosave**

**UC-17 Record Version**

**Primary actor:** System Timer (also invoked by UC-08) · **Priority:** Should · **SRS:** FR-08.1, FR-08.2, FR-08.5 **Goal:** Keep a restorable history of each document. **Preconditions:** A document is open. **Trigger:** (a) a manual save in UC-08, (b) 5 minutes pass without edits while unrecorded changes exist, or (c) a document is closed with unrecorded changes.

**Main success scenario**

1\. A trigger occurs.

2\. The system checks whether the document changed since its last recorded version.

3\. The system records a version with timestamp, author, and trigger type.

4\. The system keeps at least the 100 most recent versions of the document.

**Alternative and exception flows**

● **2a.** The document has not changed: the system records no version.

● **\*a.** Autosave (UC-20) never triggers this use case.

**Postconditions:** A new version exists, or the history is unchanged.

**UC-18 View Version History**

**Primary actor:** Viewer · **Priority:** Should · **SRS:** FR-08.3 **Goal:** See the earlier versions of a document. **Preconditions:** A project is open. Included by UC-19. **Trigger:** The user opens the history of a document.

**Main success scenario**

1\. The user selects History for a document.

2\. The system lists its versions, newest first, with timestamp, author, and trigger type.

3\. The user selects a version to inspect its content read-only.

**Alternative and exception flows**

● **2a.** The document has no versions: the system shows a message saying so.

**Postconditions:** Nothing is changed.

**UC-19 Restore Version**

**Primary actor:** Editor · **Priority:** Should · **SRS:** FR-08.4 **Goal:** Return a document to an earlier state. **Preconditions:** A project is open and the user is an Editor or Owner. **Trigger:** The user chooses Restore on a version.

**Main success scenario**

1\. The user opens the version history («include» UC-18).

2\. The user selects a version and chooses Restore.

3\. The system asks for confirmation.

4\. The user confirms.

5\. The system replaces the document content with that version.

6\. The system records the restored content as a new version (UC-17).

**Alternative and exception flows**

● **1a.** The user is a Viewer: the Restore action is unavailable.

● **4a.** The user cancels: the document is unchanged.

**Postconditions:** The document holds the chosen content and the earlier history is intact.

**UC-20 Autosave Working Copy**

**Primary actor:** System Timer · **Priority:** Must · **SRS:** NFR-02 **Goal:** Limit the loss of work after a crash. **Preconditions:** At least one document with changes is open. **Trigger:** 60 seconds (plus or minus 5\) pass since the last autosave.

**Main success scenario**

1\. The timer fires.

2\. The system writes the working copy of every open document to local storage, excluding unaccepted AI results.

3\. The system creates no version.

**Alternative and exception flows**

● **2a.** The write fails: the system shows a non-blocking warning and retries at the next cycle.

**Postconditions:** Local storage holds a working copy at most 60 seconds old.

**UC-21 Recover Working Copy**

**Primary actor:** Editor · **Priority:** Must · **SRS:** NFR-02 **Goal:** Get back unsaved work after an abnormal termination. **Preconditions:** The previous session ended abnormally. This use case extends UC-06 at its extension point. **Trigger:** The user opens a project.

**Main success scenario**

1\. The system finds an autosaved working copy newer than the saved content.

2\.

3\. The user acceptsThe system offers to restore it..

4\. The system loads the working copy, which is at most 60 seconds old.

**Alternative and exception flows**

● **3a.** The user declines: the system discards the working copy and opens the saved content.

**Postconditions:** The editor holds the recovered or saved content.

**3.7 Sharing and collaboration**

**UC-22 Manage Sharing Links**

**Primary actor:** Owner · **Priority:** Should · **SRS:** FR-09.1, FR-09.3 **Goal:** Invite other registered users with a link, or withdraw a link. **Preconditions:** The user is the Owner, Local Only mode is disabled, and the server is reachable. **Trigger:** The Owner opens Share.

**Main success scenario**

1\. The Owner chooses the role Editor or Viewer.

2\. The Owner sets an expiry (default 7 days, maximum 90 days).

3\. The system generates a link containing an unguessable token of at least 128 bits.

4\. The system shows the link so the Owner can copy it.

**Alternative and exception flows**

● **2a.** The expiry exceeds 90 days: the system rejects it; return to step 2\.

● **1a.** The Owner selects an existing link and chooses Revoke: after confirmation the system denies any further use of that link. Collaborators who already joined keep their roles.

● **\*a.** The link reaches its expiry: the system denies any further use of it.

● **\*b.** Local Only mode is enabled: the system says the function is unavailable.

**Postconditions:** The link is active until it expires or is revoked.

**UC-23 Join Project via Sharing Link**

**Primary actor:** Registered User · **Priority:** Should · **SRS:** FR-09.2 **Goal:** Gain access to a shared project. **Preconditions:** The user holds an account and has a link. **Trigger:** The user opens the link in the client.

**Main success scenario**

1\. The user opens the link.

2\. The system requires authentication and, when no session exists, starts the login («include» UC-02).

3\. The system checks that the link exists and is neither expired nor revoked.

4\. The system adds the project to the user's list with the link's role.

5\. The system opens the project (UC-06).

**Alternative and exception flows**

● **2a.** The user has no account or cancels the login: the system denies access. A user without an account must register first (UC-01).

● **3a.** The link is invalid, expired, or revoked: the system denies access and shows a message.

● **4a.** The user is already a member: the system opens the project with the existing role, unchanged.

● **\*a.** Local Only mode is enabled: the system says the function is unavailable.

**Postconditions:** Success: the user is a collaborator with the link's role. Failure: no access is granted.

**UC-24 Manage Collaborators**

**Primary actor:** Owner · **Priority:** Should · **SRS:** FR-09.4, FR-09.6 **Goal:** Control who may do what in the project. **Preconditions:** The user is the Owner, Local Only mode is disabled, and the server is reachable. **Trigger:** The Owner opens the collaborator list.

**Main success scenario**

1\. The Owner selects a collaborator.

2\. The Owner changes the role to Editor or Viewer, or removes the collaborator.

3\. The system applies the change on the server.

4\. The system shows the updated list.

**Alternative and exception flows**

● **2a.** The Owner tries to change or remove the Owner role: the system refuses.

● **\*a.** Local Only mode is enabled: the system says the function is unavailable.

**Postconditions:** The server enforces the new role on every later pull and push. A Viewer cannot change content.

**3.8 Repository synchronization**

**UC-25 Clone Project**

**Primary actor:** Viewer · **Priority:** Should · **SRS:** FR-11.1, FR-11.5, FR-11.6 **Goal:** Get a local copy of a server project. **Preconditions:** The user is authenticated, belongs to the project, and has no local copy. Local Only mode is disabled. **Trigger:** The user selects a server project and chooses Download.

**Main success scenario**

1\. The user chooses Download.

2\. The system fetches the complete project from the server.

3\. The system creates the local copy.

4\. The system opens the project (UC-06).

**Alternative and exception flows**

● **2a.** The connection is lost: the system aborts and leaves no partial local copy.

● **\*a.** Local Only mode is enabled: the system says the function is unavailable.

**Postconditions:** Success: a complete local copy exists. Failure: none exists.

**UC-26 Pull Changes**

**Primary actor:** Viewer · **Priority:** Should · **SRS:** FR-11.2, FR-11.5 to FR-11.7 **Goal:** Bring remote changes into the local copy. **Preconditions:** A local copy exists and Local Only mode is disabled. **Trigger:** The user chooses Sync or Pull. **Extension point:** merge conflict detected (UC-28).

**Main success scenario**

1\. The user chooses Sync or Pull.

2\. The system fetches the remote changes.

3\. The system merges them into the local copy, leaving out compilation outputs (.aux, .log, generated .pdf).

4\. The system reports the result.

**Alternative and exception flows**

● **2a.** There are no remote changes: the system says the project is up to date.

● **2b.** The connection is lost: the system aborts and leaves the local copy consistent.

● **3a.** A merge conflict occurs: UC-28 extends this use case.

● **\*a.** Local Only mode is enabled: the system says the function is unavailable.

**Postconditions:** The local copy contains the remote changes, or is unchanged.

**UC-27 Push Changes**

**Primary actor:** Editor · **Priority:** Should · **SRS:** FR-11.3, FR-11.4, FR-11.6 **Goal:** Share local changes with the server. **Preconditions:** A local copy with changes exists, the user is an Editor or Owner, and Local Only mode is disabled. **Trigger:** The user chooses Push.

**Main success scenario**

1\. The user chooses Push.

2\. The system checks that the local copy is up to date and has no unresolved conflicts.

3\. The server checks the user's role.

4\. The system uploads the changes.

5\. The system confirms the push.

**Alternative and exception flows**

● **2a.** The local copy is outdated: the system rejects the push and asks the user to pull first (UC-26).

● **2b.** Conflicts are unresolved: the system blocks the push until they are resolved (UC-28).

● **2c.** The project has no server copy yet: the server creates the central copy and registers the user as Owner (assumption 1 in section 4).

● **3a.** The user is a Viewer: the server rejects the push.

● **4a.** The connection is lost: the system aborts and leaves both copies consistent.

● **\*a.** Local Only mode is enabled: the system says the function is unavailable.

**Postconditions:** Success: the server holds the changes. Failure: the server copy is unchanged.

**UC-28 Resolve Merge Conflict**

**Primary actor:** Editor · **Priority:** Should · **SRS:** FR-11.4 **Goal:** Decide how conflicting changes are combined. **Preconditions:** A pull found conflicting changes. This use case extends UC-26 at its extension point. **Trigger:** UC-26 detects a merge conflict.

**Main success scenario**

1\. The system lists the conflicting files.

2\. For each conflict, the system shows the local and remote text side by side.

3\. The user chooses the local text, the remote text, or an edited text.

4\. The system marks the conflict resolved.

5\. When all conflicts are resolved, the system completes the merge and enables pushing.

**Alternative and exception flows**

● **3a.** The user leaves conflicts unresolved: the merge stays pending and pushing stays blocked.

**Postconditions:** The merge is complete, or still pending with pushing blocked.

**4\. Relevant Considerations: Global, Social, and Environmental Concerns**

**4.1 Social & Ethical Concerns**

The strict hardware requirement of an NVIDIA GPU with at least 4 GB of VRAM introduces a significant accessibility barrier for researchers and students in lower-resource settings or those relying on integrated graphics. The dual-architecture design directly addresses this equity gap by offering API model fallbacks alongside local inference, ensuring that users without high-end local hardware can still access core software capabilities when connected to the internet.

Academic manuscripts frequently contain proprietary methodologies, patentable innovations, or unpublished research findings that pose severe confidentiality risks if transmitted to third-party cloud services. The system mitigates this vulnerability through a global **Local Only** setting that completely isolates local AI workflows and compilation, preventing accidental data transmission or telemetry logging.

Automated rephrasing or grammar corrections risk introducing plagiarism, introducing hallucinations, or compromising academic integrity. To prevent silent or inaccurate text generation, a strict "Zero Silent Edits" policy mandates explicit human-in-the-loop verification via side-by-side diff acceptance and rejection controls. Additionally, detailed version tracking logs author contributions versus AI modifications to maintain clear, auditable attribution.

Local LLM tasks designed to refine academic tone may inadvertently enforce linguistic hegemony by favoring standard Western academic phrasing over valid regional or non-native writing styles. The application provides granular, hunk-level diff controls that allow authors to reject over-corrections and retain their unique writing voice.

Automating LaTeX error fixes and caption generation could lead to student de-skilling and an over-reliance on automated tools over time. To counter this, the syntax error correction task provides plain-language explanations alongside proposed code fixes, transforming automated correction into an educational reference tool.

**4.2 Environmental Concerns**

Running local LLM inference continuously on consumer GPUs increases operational power consumption compared to lightweight text editors. The editor minimizes compute overhead by executing local AI tasks strictly on demand, enforcing a 1,000-word input cap per request, and constraining the model context window to 4,096 tokens.

Unbounded document compilation processes can waste host system resources through continuous CPU and memory utilization. The system enforces sandboxed execution environments restricted to 2 CPU cores, 2 GB of RAM, and a 60-second wall-clock timeout, preventing runaway compilation loops and conserving device energy.

High hardware entry requirements risk accelerating electronic waste cycles as academic institutions refresh hardware to run local AI models. The underlying adapter interface allows maintainers to swap in smaller, quantized local models over time, extending the operational lifespan of existing laboratory hardware.

Retaining extensive version histories across hundreds of shared projects increases central cloud storage footprints and energy demands. To minimize server payload sizes and storage consumption, the system automatically excludes binary compilation outputs—such as **.aux**, **.log**, and generated **.pdf** files—from repository synchronization.

**4.3 Global Concerns**

Researchers in developing regions or remote environments frequently encounter unstable or limited internet connectivity. All core editor functions—including document editing, compilation, local AI processing, and version history—operate entirely offline over loopback interfaces, enabling uninterrupted productivity without relying on persistent server connections.

Non-English LaTeX manuscripts containing localized encodings or non-Latin scripts may experience reduced generation quality when processed by models trained primarily on English text. The system's developer adapter abstraction layer allows maintainers to swap or update underlying models to language-specific or regional variants without requiring changes to the user interface.