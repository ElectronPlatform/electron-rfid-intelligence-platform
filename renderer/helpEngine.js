/*
 * Team Electron Help Engine v1.0
 * Contextual help that stays on the screen where the user is working.
 */
(function(){
  const STORAGE_KEY = "teamElectron.showHelpEngineIcons";

  const helpTopics = {
    selectVisibleBtn: {
      title: "Select All",
      body: `<p>Selects all RFID tags currently visible in the Inventory table.</p><ul><li>Search filters affect which tags are visible.</li><li>Dashboard filters also affect the visible list.</li><li>No RFID tag data is changed.</li></ul>`
    },
    clearSelectionBtn: {
      title: "Clear Selection",
      body: `<p>Clears the current RFID tag selection.</p><ul><li>No RFID tags are deleted.</li><li>No data is changed.</li><li>Use this before selecting a different group of tags.</li></ul>`
    },
    exportJsonBtn: {
      title: "Export JSON",
      body: `<p>Creates a new JSON export of the selected RFID tags.</p><ul><li>A new file is always created.</li><li>Existing export files are not overwritten.</li><li>Use this for backups, snapshots or sharing selected tags.</li></ul>`
    },
    updateLastExportBtn: {
      title: "Export to Last File",
      body: `<p>Updates the last JSON export file used by the app.</p><ul><li>The Delta Engine shows what will change before writing.</li><li>You choose which RFID tags are updated.</li><li>A .bak backup is created before the file is changed.</li></ul>`
    },
    updateExistingExportBtn: {
      title: "Export to Existing File",
      body: `<p>Exports selected RFID tags into an existing JSON export file.</p><ul><li>You choose the existing file.</li><li>The Delta Engine compares the file with the current inventory.</li><li>A .bak backup is created before writing.</li></ul>`
    },
    importJsonBtn: {
      title: "Import Tags",
      body: `<p>Imports RFID tags from a JSON export file.</p><ul><li>Existing tags are compared before importing.</li><li>You choose which tags are added or updated.</li><li>The Delta Engine shows differences before data is changed.</li></ul>`
    },
    exportCsvBtn: {
      title: "Export CSV",
      body: `<p>Exports selected RFID tags to a CSV file.</p><ul><li>Useful for Excel, Numbers, LibreOffice or Google Sheets.</li><li>Best for lists and reports.</li><li>Does not include all internal JSON database details.</li></ul>`
    },
    savePhotoSettingsBtn: { title:"Save Photo Settings", body:`<p>Saves the current photo compression and preview settings.</p><ul><li>Newly selected photos use these settings.</li><li>Existing stored photos are not rewritten automatically.</li></ul>` },
    resetPhotoSettingsBtn: { title:"Reset Photo Settings", body:`<p>Restores the default photo size and quality settings.</p><ul><li>Use this if previews become too large, too small or too compressed.</li><li>No RFID tag records are deleted.</li></ul>` },
    revertPhotoThumbMaxSide: { title:"Revert Thumbnail Size", body:`<p>Restores this field to the currently saved thumbnail size.</p><ul><li>This does not save changes by itself.</li></ul>` },
    revertPhotoThumbQuality: { title:"Revert Thumbnail Quality", body:`<p>Restores this field to the currently saved thumbnail quality.</p><ul><li>This does not save changes by itself.</li></ul>` },
    revertPhotoFullMaxSide: { title:"Revert Preview Size", body:`<p>Restores this field to the currently saved full preview size.</p><ul><li>This does not save changes by itself.</li></ul>` },
    revertPhotoFullQuality: { title:"Revert Preview Quality", body:`<p>Restores this field to the currently saved full preview quality.</p><ul><li>This does not save changes by itself.</li></ul>` },
    addPm3SafetyBlockBtn: { title:"Add Blocked Command", body:`<p>Adds a command or command pattern to Electron's Device Command Safety list.</p><ul><li>Matching commands are blocked before running.</li><li>The current device adapter still uses pm3 command syntax.</li></ul>` },
    openDatabaseManagerBtn: { title:"Database Manager", body:`<p>Opens database maintenance tools.</p><ul><li>Create a full database backup.</li><li>Restore a complete database.</li><li>Clear the database after an automatic safety backup.</li></ul>` },
    browseBackupFolderBtn: { title:"Choose Backup Folder", body:`<p>Selects the default folder Electron uses for exports and backup-related files.</p><ul><li>Use this to keep reports and backups in a predictable location.</li><li>The folder choice is stored locally.</li></ul>` },
    resetBackupFolderBtn: { title:"Restore Path to Default Location", body:`<p>Resets the backup/export folder to Electron's default location.</p><ul><li>Useful if a custom folder was moved or removed.</li><li>Existing files are not moved or deleted.</li></ul>` },
    runPreviewChecklistBtn: { title:"Run Preview Build Checklist", body:`<p>Runs Electron's local Preview release checklist.</p><ul><li>Checks Preview Mode, app name, packaging scope, privacy-sensitive starter data and internal tool visibility.</li><li>Useful before sharing a Preview build with testers.</li><li>This does not send data anywhere.</li></ul>` },
    openAssetDialogBtn: { title:"Open RFID Tag", body:`<p>Opens a compact list of RFID tags already saved in Collection.</p><ul><li>Search by RFID Tag ID or Alias / Name by default.</li><li>More Search Options can include other saved fields.</li><li>Selecting a tag does not change it until you save edits.</li></ul>` },
    restoreOpenAssetBtn: { title:"Open RFID Tag", body:`<p>Selects the Collection record used by Restore Helper.</p><ul><li>No restore command is generated until a tag is selected.</li><li>Selecting a tag does not change the record or physical card.</li></ul>` },
    compareOpenAssetABtn: { title:"Open Source RFID Tag", body:`<p>Selects the first Collection record for comparison.</p><ul><li>The comparison remains read-only.</li></ul>` },
    compareOpenAssetBBtn: { title:"Open Destination RFID Tag", body:`<p>Selects the second Collection record for comparison.</p><ul><li>Choose a different tag from the source.</li><li>The comparison does not modify either record.</li></ul>` },
    compareStoreOpenAssetBtn: { title:"Choose RFID Tag for Dump", body:`<p>Selects the Collection record that should reference the chosen dump file.</p><ul><li>The physical tag is not changed.</li></ul>` },
    labelOpenAssetBtn: { title:"Open RFID Tag", body:`<p>Selects the Collection record used for the label preview.</p><ul><li>Label data comes from the selected saved record.</li></ul>` },
    newAssetEntryBtn: { title:"New RFID Tag", body:`<p>Starts the existing new RFID tag workflow.</p><ul><li>The app assigns the next available RFID Tag ID.</li><li>Nothing is saved until you press Save RFID Tag.</li></ul>` },
    newAssetBtn: { title:"New RFID Tag", body:`<p>Starts a new RFID tag record.</p><ul><li>The app assigns the next available RFID Tag ID.</li><li>Nothing is saved until you press Save RFID Tag.</li></ul>` },
    saveAssetBtn: { title:"Save RFID Tag", body:`<p>Saves the current RFID tag record.</p><ul><li>New records are added to the inventory.</li><li>Existing records are updated.</li><li>A Change Log entry is created.</li></ul>` },
    duplicateAssetBtn: { title:"Duplicate RFID Tag", body:`<p>Creates a copy of the current RFID tag record with a new RFID Tag ID.</p><ul><li>Useful for similar physical tags.</li><li>Backup files are not copied to the duplicate.</li></ul>` },
    markUnusableBtn: { title:"Mark Unusable", body:`<p>Marks the current RFID tag as unusable.</p><ul><li>The record stays in the database.</li><li>A note is added with the current date.</li></ul>` },
    deleteAssetBtn: { title:"Delete RFID Tag", body:`<p>Deletes the current RFID tag record from the database.</p><ul><li>Use this for database mistakes only.</li><li>RFID Tag IDs are not reused.</li></ul>` },
    selectPhotoBtn: { title:"Select Photo", body:`<p>Adds a photo to the current RFID tag record.</p><ul><li>The image is stored inside the local database.</li><li>Photo settings control preview size and compression.</li></ul>` },
    removePhotoBtn: { title:"Remove Photo", body:`<p>Removes the stored photo from the current RFID tag record.</p><ul><li>The RFID tag record itself remains.</li><li>You can save the record afterward to keep the removal.</li></ul>` },
    parseNewBtn: { title:"Parse as New RFID Tag", body:`<p>Reads pasted device output and prepares a new RFID tag record.</p><ul><li>Detected UID, type and frequency are filled in automatically when possible.</li></ul>` },
    updateFromScanBtn: { title:"Update Current RFID Tag from Scan", body:`<p>Reads pasted device output and updates the currently open form.</p><ul><li>Use this when the physical tag belongs to the selected record.</li></ul>` },
    clearScanBtn: { title:"Clear", body:`<p>Clears the pasted device output text box.</p><ul><li>No RFID tag data is changed.</li></ul>` },
    listPm3Btn: { title:"Check Device", body:`<p>Checks whether Electron can see the connected RFID device through the current device adapter.</p><ul><li>Useful before connecting or scanning.</li><li>The current adapter uses the pm3 client for Proxmark3-compatible devices.</li></ul>` },
    startPm3Btn: { title:"Connect Device", body:`<p>Starts a live connection to the RFID device.</p><ul><li>Close Chrome/Web Serial first.</li><li>Only one app can use the device serial port at a time.</li></ul>` },
    stopPm3Btn: { title:"Disconnect Device", body:`<p>Stops the current RFID device connection.</p>` },
    deviceProfileSelect: { title:"Device Profile", body:`<p>Selects the active RFID reader profile.</p><ul><li>Proxmark3 is currently the fully working adapter.</li><li>Other devices are prepared as profiles and command libraries for future support.</li><li>Card Lab and Electron's device safety checks use this profile to understand capabilities.</li></ul>` },
    readRegisterBtn: { title:"Read / Identify HF+LF", body:`<p>Runs a safe scan to identify the RFID tag currently on the reader antenna.</p><ul><li>Starts with HF detection.</li><li>If no HF UID is parsed, Electron tries LF detection.</li><li>Detected tags are compared with the current inventory.</li></ul>` },
    hwVersionBtn: { title:"Device Information", body:`<p>Asks the connected reader for hardware and firmware information.</p><ul><li>Useful to confirm the device is responding.</li><li>Does not scan or modify a card.</li></ul>` },
    scanHfBtn: { title:"Scan HF", body:`<p>Runs <code>hf search</code> to look for 13.56 MHz RFID/NFC cards.</p><ul><li>Good first step for MIFARE, NTAG, DESFire, ISO14443 and ISO15693 style cards.</li><li>Read-only identification scan.</li></ul>` },
    scanLfBtn: { title:"Scan LF", body:`<p>Runs <code>lf search</code> to look for low-frequency tags.</p><ul><li>Useful for EM410x, HID Prox, Indala, Hitag and other LF formats.</li><li>Read-only identification scan.</li></ul>` },
    hfMfInfoBtn: { title:"HF MF Info", body:`<p>Runs a MIFARE Classic information command.</p><ul><li>Use this after an HF scan suggests MIFARE Classic.</li><li>It gathers card metadata; protected sector contents still require authorized keys.</li></ul>` },
    sendCmdBtn: { title:"Send", body:`<p>Sends the manual device command entered in the command box.</p><ul><li>Use only commands you understand.</li><li>Electron checks configured safety rules before running commands.</li></ul>` },
    parseConsoleBtn: { title:"Parse Console into Form", body:`<p>Copies the console output into the RFID Tag form parser.</p><ul><li>Useful after a scan if you want to create or update a tag record.</li></ul>` },
    copyConsoleBtn: { title:"Copy Console", body:`<p>Copies the complete current Device Console output to the clipboard.</p><ul><li>Use it to paste a command log into a message, bug report or other tool.</li><li>No RFID tag data is changed.</li></ul>` },
    clearConsoleBtn: { title:"Clear Console", body:`<p>Clears the Device Console output.</p><ul><li>No RFID tag data is changed.</li></ul>` },
    followConsoleBtn: { title:"Follow Output", body:`<p>Scrolls the Device Console to the latest output automatically.</p>` },
    uidRegisterNewBtn: { title:"Register as New Physical Asset", selector:"[data-help-topic='uidRegisterNewBtn']", body:`<p>Creates a new Collection record from the detected UID even when Electron has seen the UID before.</p><ul><li>Use this when the same UID belongs to a separate physical tag you want to track.</li><li>Electron keeps the warning so you can decide whether this is a real duplicate, clone or inventory exception.</li></ul>` },
    uidRegisterCloneBtn: { title:"Register Clone", selector:"[data-help-topic='uidRegisterCloneBtn']", body:`<p>Prepares a new RFID tag record as a clone of the matched Collection record.</p><ul><li>Use this when the scanned tag is a physical clone/copy of an existing tag.</li><li>Electron links the new record to the original through the Clone of field.</li><li>Review and save the new record before relying on it.</li></ul>` },
    saveCommandSetBtn: { title:"Save Command Set", body:`<p>Saves the commands currently listed in the command set editor.</p><ul><li>Use this for repeatable safe workflows.</li><li>Commands are stored locally in Electron.</li></ul>` },
    runCommandSetBtn: { title:"Run Selected Command Set", body:`<p>Runs the selected saved command set in order.</p><ul><li>Review the command list before running.</li><li>Electron blocks unsafe manual command patterns where possible.</li></ul>` },
    deleteCommandSetBtn: { title:"Delete Command Set", body:`<p>Deletes the selected saved command set.</p><ul><li>This removes the saved workflow only.</li><li>RFID tag records and scan history are not deleted.</li></ul>` },
    reloadDeviceCommandsBtn: { title:"Reload Command JSON", body:`<p>Reloads bundled device profiles and command libraries from JSON.</p><ul><li>Custom imported libraries remain stored locally.</li><li>Use this after manually editing command JSON while testing.</li></ul>` },
    importDeviceCommandsBtn: { title:"Import Command Library", body:`<p>Imports a device command library from JSON.</p><ul><li>The JSON should include a <code>deviceId</code> and a <code>commands</code> array.</li><li>Imported commands are stored locally and merged with the bundled library.</li></ul>` },
    exportDeviceCommandsBtn: { title:"Export Command Library", body:`<p>Exports the current device command library to JSON.</p><ul><li>Useful when manually editing or sharing command definitions.</li></ul>` },
    backupDumpFieldHelp: { title:"Dump file", body:`<p>Reference to the complete card memory dump, usually a <code>.bin</code> file.</p><ul><li>For MIFARE Classic this is the main backup evidence.</li><li>Use Browse... to avoid typing paths manually.</li><li>For simple LF tags this may be raw output evidence instead of a full memory dump.</li></ul>` },
    backupJsonFieldHelp: { title:"JSON file", body:`<p>Optional JSON metadata generated by supported Proxmark3 workflows.</p><ul><li>Useful for readable structure and later tooling.</li><li>Not every card type creates or needs a JSON backup.</li></ul>` },
    backupKeyFieldHelp: { title:"Key file", body:`<p>Reference to recovered authentication keys for this RFID tag.</p><ul><li>Mainly relevant to cards with protected sectors, such as MIFARE Classic.</li><li>Simple ID-only LF tags usually do not use key files.</li></ul>` },
    backupOutputHelp: { title:"Automatic key recovery output", body:`<p>Paste the complete output of <code>hf mf autopwn</code> here.</p><ul><li>This is an authorised-use MIFARE Classic recovery command.</li><li>Electron scans the text for dump, JSON and key file references.</li><li>This is optional if you use Browse... to select files directly.</li></ul>` },
    backupCommandsHelp: { title:"Suggested Backup Workflow", body:`<p>Shows a beginner-friendly backup workflow for the selected card type.</p><ul><li>Read-only detection steps come first.</li><li>More advanced backup commands are clearly marked as authorised-use only.</li><li>Electron does not run write or restore commands from this section.</li></ul>` },
    detectBackupBtn: { title:"Detect Backup Files", body:`<p>Reads the pasted automatic key recovery output and tries to fill backup fields automatically.</p><ul><li>Looks for dump, JSON and key file names.</li><li>Does not run any device command.</li><li>You can still adjust the fields before saving.</li></ul>` },
    saveBackupBtn: { title:"Save Backup Info", body:`<p>Saves the backup references to the selected RFID tag record.</p><ul><li>Updates Backup Status and Last backup.</li><li>Restore Helper can use these references later.</li><li>No card is written and no dump is created by this button.</li></ul>` },
    browseBackupDumpBtn: { title:"Browse Dump File", body:`<p>Selects a dump or backup evidence file from disk.</p><ul><li>Electron also checks the same folder for matching JSON and key files.</li></ul>` },
    browseBackupJsonBtn: { title:"Browse JSON File", body:`<p>Selects optional JSON backup metadata from disk.</p><ul><li>Electron also checks the same folder for matching dump and key files.</li></ul>` },
    browseBackupKeyBtn: { title:"Browse Key File", body:`<p>Selects a key file from disk.</p><ul><li>Electron also checks the same folder for matching dump and JSON files.</li></ul>` },
    generateRestoreBtn: { title:"Generate Restore Commands", body:`<p>Generates suggested Proxmark3 restore commands for the selected RFID tag and target type.</p><ul><li>Always review commands before running them.</li></ul>` },
    copyRestoreBtn: { title:"Copy Commands", body:`<p>Copies the generated restore commands to the clipboard.</p>` },
    compareManagedBtn: { title:"Compare Registered Backups", body:`<p>Compares stored dump backups between two registered RFID tags.</p><ul><li>Uses database-linked dumps, not random files on your Mac.</li></ul>` },
    storeManagedDumpBtn: { title:"Store Dump in Database", body:`<p>Stores a selected .bin dump inside the selected RFID tag record.</p>` },
    compareDumpsBtn: { title:"Compare Loose Dump Files", body:`<p>Compares two manually selected .bin files.</p><ul><li>Advanced/manual workflow.</li><li>Files are not automatically linked to the database.</li></ul>` },

    cardLabHelpBtn: { title:"Card Lab", body:`<p>Card Lab is the guided scan-to-report workflow.</p><ul><li>Quick Scan and Explore Card update Start, Detect, Explain and Report.</li><li>After a successful scan Electron prepares the internal Report Model.</li><li>Export Report uses that prepared model when you choose to export.</li></ul>` },
    atlasAssistantPackBtn: { title:"Create Assistant Review Pack", body:`<p>Collects the current Card Lab context into a local review pack.</p><ul><li>Includes recent scan output, analysis context and loaded knowledge metadata.</li><li>Nothing is uploaded automatically.</li></ul>` },
    atlasStartScanBtn: { title:"Quick Scan", body:`<p>Runs the guided quick identification workflow.</p><ul><li>Electron tries safe scan commands and explains the result.</li><li>After a successful scan, the Report Model is prepared automatically.</li></ul>` },
    atlasExploreCardBtn: { title:"Explore Card", body:`<p>Runs a deeper safe investigation for the detected card family.</p><ul><li>Uses read-only commands selected by Electron.</li><li>Builds richer Card Intelligence and report context.</li></ul>` },
    atlasClearBtn: { title:"Clear Card Lab", body:`<p>Clears the current Card Lab result and returns the workflow to the start state.</p><ul><li>No inventory records are deleted.</li><li>Use this before scanning a different card.</li></ul>` },
    atlasAnalyseConsoleBtn: { title:"Analyse Latest Device Output", body:`<p>Reads the current Device Console text and asks the Knowledge Engine to identify the likely card technology.</p><ul><li>This does not run a new device command.</li><li>Use it after Read / Identify, Scan HF or Scan LF.</li></ul>` },
    atlasAnalysePasteBtn: { title:"Analyse Pasted Output", body:`<p>Analyses device output pasted into the Card Lab text box.</p><ul><li>Useful for testing older logs or copied terminal output.</li><li>No RFID data is changed.</li></ul>` },
    atlasLoadLatestBtn: { title:"Load Latest Console Output", body:`<p>Copies the current Device Console output into the Card Lab paste box.</p><ul><li>Useful when you already ran a command in Device Console.</li><li>Does not run a new scan by itself.</li></ul>` },
    atlasClearPasteBtn: { title:"Clear Paste Box", body:`<p>Clears the pasted Card Lab analysis text.</p><ul><li>No inventory data is changed.</li></ul>` },
    electronResearchExportBtn: { title:"Export Research Backup", body:`<p>Exports the local Electron research database.</p><ul><li>Includes Research Library, Known by You, signatures and related local context.</li><li>Use this before larger cleanup or testing work.</li></ul>` },
    previewFeedbackClearPastedScreenshot: { title:"Clear Pasted Screenshots", body:`<p>Removes screenshots pasted or dropped into this feedback window.</p><ul><li>Only the extra pasted screenshots are cleared.</li><li>Your title, description and selected options remain unless you clear the full feedback window.</li></ul>` },
    previewFeedbackClearWindowBtn: { title:"Clear Feedback Window", body:`<p>Clears the saved feedback draft in this window.</p><ul><li>Use this after you no longer need the current title, description or selected options.</li><li>If you close without clearing, Electron remembers the written feedback draft for later.</li><li>Pasted screenshots are temporary and are not kept after the window/app session.</li></ul>` },
    previewFeedbackCreatePackageBtn: { title:"Create Feedback Package", body:`<p>Creates a local ZIP-style feedback package folder for you to review and share manually.</p><ul><li>Includes feedback text and a summary JSON.</li><li>Includes screenshots, Electron log or Device Console output only when you selected them.</li><li>Also creates an HTML preview so you can inspect the package contents more easily.</li><li>Nothing is uploaded automatically.</li></ul>` },
    openCardIntelligenceAction: { title:"Open Card Intelligence", selector:"[data-electron-action='open-card-intelligence']", body:`<p>Opens the detailed Card Intelligence view for the current scan.</p><ul><li>Shows what Electron thinks the card is and why.</li><li>Includes readable data, protected-data summary, Known by You context and report actions where available.</li></ul>` },
    teachElectronAction: { title:"Teach Electron", selector:"[data-electron-action='teach-electron']", body:`<p>Saves a local research record for this card signature.</p><ul><li>Use this to teach Electron what this card is used for in the real world.</li><li>Research records stay local in the Electron database.</li><li>Nothing is uploaded automatically.</li></ul>` },
    knownByYouAction: { title:"Known by You", selector:"[data-electron-action='known-by-you']", body:`<p>Adds or edits your personal context for this card.</p><ul><li>Useful for owner, nickname, location, purpose or safe notes.</li><li>This is stored locally and helps Electron recognise the card later.</li><li>Do not store secrets, keys or private numbers here.</li></ul>` },
    editResearchAction: { title:"Edit Research", selector:"[data-electron-action='edit-research']", body:`<p>Opens the linked local research record so you can correct or extend Electron's knowledge.</p><ul><li>Use this when the card type is known but the explanation or usage needs better context.</li><li>The change stays in the local Electron database.</li></ul>` },
    refreshLabelBtn: { title:"Refresh Label", body:`<p>Refreshes the label preview for the selected RFID tag.</p>` },
    printLabelBtn: { title:"Print Preview", body:`<p>Opens the current label in the print preview flow.</p><ul><li>Review the label before printing.</li><li>Use this for normal macOS printer selection.</li></ul>` },
    directPrintLabelBtn: { title:"Direct Print", body:`<p>Direct label printing is reserved for configured label printers.</p><ul><li>The button stays disabled until a printer profile is available.</li><li>Print Preview remains the active workflow.</li></ul>` }
    ,sendFeedbackBtn: { title:"Send Feedback", body:`<p>Opens Electron's local feedback form.</p><ul><li>You choose the description, screenshots, logs and device output to include.</li><li>Electron creates a package for you to review and share manually.</li><li>Nothing is uploaded automatically.</li></ul>` }
    ,inventoryHelpBtn: { title:"Inventory", body:`<p>Explains the Collection workspace and its inventory tools.</p><ul><li>Use the tools here to search, select, import and export saved RFID records.</li><li>Opening this help does not change any records.</li></ul>` }
    ,openDeviceCommandLibraryBtn: { title:"Open Command Library", body:`<p>Opens the Proxmark3 command library for the selected device profile.</p><ul><li>Each command includes a description, category and expected output where available.</li><li>Review a command before running it.</li><li>Safe Mode can still block selected high-risk commands.</li></ul>` }
    ,deviceStudioHotspotEditorBtn: { title:"Calibrate Hotspots", body:`<p>Opens Developer Calibration for the current Device Studio photo.</p><ul><li>Use it to adjust shapes, pointers, callout lines and labels.</li><li>Changes stay local until you choose Save layout.</li><li>This is a developer-only visual layout tool; it does not change the Proxmark3.</li></ul>` }
    ,deviceStudioQuickRefreshBtn: { title:"Quick Refresh", body:`<p>Reads the latest Device Studio status through the warm device session.</p><ul><li>It refreshes reported state, Safe Mode status and diagnostic metrics.</li><li>It does not retune the HF or LF antennas.</li><li>Use this for a fast status update.</li></ul>` }
    ,deviceStudioFullCheckBtn: { title:"Full RF Check", body:`<p>Runs the complete safe Device Studio diagnostic check.</p><ul><li>Includes device version/status and HF/LF antenna measurements.</li><li>It can take several seconds; the progress panel shows what is happening.</li><li>It does not write to a card or flash firmware.</li></ul>` }
    ,deviceStudioSafeModeHelp: { title:"Device Studio Safe Mode", body:`<p>Safe Mode is a firmware-side guard for the current Device Studio session.</p><ul><li>When on, selected write, clone, emulation and standalone commands are blocked by the Proxmark3 firmware.</li><li>Turning it off requires confirmation and makes supported advanced commands available again through the Device Console or PM3 client, when the connected device supports them.</li><li>Electron does not provide a guided cloning workflow. Advanced commands are manual, require appropriate authorisation, and remain your responsibility.</li><li>Device Studio itself remains a diagnostic workspace.</li></ul>` }
    ,cardViewerHelp: { title:"Card Viewer", body:`<p>Turns the latest card data already read by Electron into a human-friendly summary.</p><ul><li>Opening Card Viewer does not start a scan or send a PM3 command.</li><li>Protected fields, key values and sector results appear only after a stored authorized read succeeded.</li><li>During Deep Scan or a family-specific workflow, a floating panel shows only workflow steps Electron actually started. Card Viewer keeps your current scroll position while the workflow runs.</li><li>Drag the title bar to move the viewer and drag the lower-right grip to resize it.</li><li>Use <b>Full screen</b>, or double-click the title bar, to fill the app window. Restore returns to the previous position and size.</li><li>Double-click the resize grip to restore the default size.</li><li>Electron does not infer whether a credential is valid or which doors it opens unless those values were actually present in the read data.</li></ul>` }
    ,atlasCardViewerBtn: { title:"Card Viewer", body:`<p>Opens a human-friendly summary of card data Electron has already read.</p><ul><li>This button does not scan a card or send a PM3 command.</li><li>Public fields come from stored scan data.</li><li>Protected fields, keys and sector results require an existing successful authorized read.</li></ul>` }
    ,openDeviceStudioFromStandaloneBtn: { title:"Open Device Studio Details", body:`<p>Moves from Standalone Studio to Device Studio.</p><ul><li>Use it to see the connected board, components and live diagnostics.</li><li>No firmware mode or RFID data is changed.</li></ul>` }
    ,portalVisitWebsiteBtn: { title:"Visit Electron Portal", body:`<p>Opens Electron's public portal page in your browser.</p><ul><li>Use it for project information and public support routes.</li><li>Your RFID records, logs and feedback are not sent automatically.</li></ul>` }
    ,portalSendFeedbackBtn: { title:"Send Feedback", body:`<p>Opens the local feedback-package flow.</p><ul><li>You decide what information to include.</li><li>Nothing is uploaded automatically.</li></ul>` }
    ,portalRefreshBtn: { title:"Refresh Portal", body:`<p>Reloads the local Electron Portal information shown in this app.</p><ul><li>It refreshes Preview and support details.</li><li>It does not contact the RFID device or upload data.</li></ul>` }
    ,customPm3Action: { title:"Custom Command Button", selector:"[data-custom-pm3-action]", body:`<p>Runs the command you previously assigned to this custom button.</p><ul><li>Review the saved command and its explanation before using it.</li><li>Electron's safety checks and Device Studio Safe Mode still apply where supported.</li></ul>` }
    ,addDeviceCommandBtn: { title:"Add Command", body:`<p>Creates a new local command definition in the Device Command Library.</p><ul><li>Add a clear name, command text and explanation so the action remains understandable later.</li><li>Custom definitions are stored locally.</li></ul>` }
    ,reloadDeviceCommandsModalBtn: { title:"Reload JSON", body:`<p>Reloads the bundled Device Command Library JSON.</p><ul><li>Use this after editing command definitions during development.</li><li>Custom imported commands remain stored locally.</li></ul>` }
    ,importDeviceCommandsModalBtn: { title:"Import JSON", body:`<p>Imports a Device Command Library from a JSON file.</p><ul><li>Review the source before importing commands.</li><li>Imported definitions are stored locally.</li></ul>` }
    ,exportDeviceCommandsModalBtn: { title:"Export JSON", body:`<p>Exports the current Device Command Library to a JSON file.</p><ul><li>Use this for backup, editing or sharing command definitions.</li><li>No command is run by exporting.</li></ul>` }
    ,clearDeviceCommandTerminalBtn: { title:"Clear Output", body:`<p>Clears only the Command Library output panel.</p><ul><li>It does not erase the main Device Console history or change RFID data.</li></ul>` }
    ,copyDeviceCommandTerminalBtn: { title:"Copy Output", body:`<p>Copies the Command Library output panel to the clipboard.</p><ul><li>Use it to share a command result, error or log elsewhere.</li></ul>` }
    ,portalDocumentationAction: { title:"Documentation", selector:"[data-portal-documentation]", body:`<p>Opens Electron documentation in your browser.</p><ul><li>Use it for project and workflow guidance.</li><li>No device data is shared automatically.</li></ul>` }
    ,portalContactAction: { title:"Contact / Feedback", selector:"[data-portal-contact]", body:`<p>Opens Electron's public contact page.</p><ul><li>It explains the support route and user-controlled sharing options.</li><li>Nothing is sent automatically.</li></ul>` }
    ,portalFeedbackAction: { title:"Create Feedback Package", selector:"[data-portal-feedback]", body:`<p>Starts the local feedback-package flow.</p><ul><li>You select the text, screenshots, logs or output to include.</li><li>The package remains local until you choose to share it.</li></ul>` }
    ,portalInstructionsAction: { title:"Preview Testing Instructions", selector:"[data-portal-instructions]", body:`<p>Opens the instructions for testing this Preview build.</p><ul><li>Use it to understand what to check and how to report a finding.</li></ul>` }
    ,portalExtensionAction: { title:"Request Preview Extension", selector:"[data-portal-extension]", body:`<p>Opens the user-controlled route for requesting extra Preview access.</p><ul><li>No request is sent automatically.</li><li>You review and send any message yourself.</li></ul>` }
    ,portalOpenFeedbackFolderAction: { title:"Open Feedback Folder", selector:"[data-portal-open-feedback-folder]", body:`<p>Opens the local folder where Electron stores feedback packages.</p><ul><li>It does not upload or delete anything.</li></ul>` }
    ,portalCopySupportAction: { title:"Copy Support Info", selector:"[data-portal-copy-support]", body:`<p>Copies basic support information to the clipboard.</p><ul><li>It excludes RFID records, card keys, dumps and logs.</li></ul>` }
    ,deviceStudioExplainAction: { title:"Explain", selector:"[data-device-studio-action='explain']", body:`<p>Opens the full explanation for the selected hardware component.</p><ul><li>Shows its purpose, current reported state, technical role and related components.</li><li>It does not run a device command or change the hardware.</li></ul>` }
    ,deviceStudioFirmwareAction: { title:"Firmware", selector:"[data-device-studio-action='firmware']", body:`<p>Opens the Firmware Explorer for the selected component.</p><ul><li>Shows firmware-reported status, relevant modules and local read-only source references when available.</li><li>It never edits, flashes or changes firmware.</li></ul>` }
    ,deviceStudioMoreAction: { title:"More", selector:"[data-device-studio-action='more']", body:`<p>Opens the complete detail view for the selected component.</p><ul><li>Use it when the compact panel is not enough and you want all available technical, status and safety information together.</li><li>It is informational only.</li></ul>` }
    ,deviceStudioOverlayOverviewTab: { title:"Overview", body:`<p>Shows a plain-language explanation of the selected component.</p><ul><li>Explains what it is, why it is on the board, its current reported state and what can safely be done.</li><li>Opening this tab does not run a command.</li></ul>` }
    ,deviceStudioOverlayTechnicalTab: { title:"Technical", body:`<p>Shows the more technical explanation of the selected component.</p><ul><li>Includes its radio role, related components, physical location and what would be affected if it were missing.</li><li>It is explanatory only.</li></ul>` }
    ,deviceStudioOverlayFirmwareTab: { title:"Firmware", body:`<p>Shows how the installed firmware reports or uses the selected component.</p><ul><li>Includes relevant modules, firmware role and safety notes where locally documented.</li><li>It never edits or flashes firmware.</li></ul>` }
    ,deviceStudioOverlaySourceTab: { title:"Source", body:`<p>Shows local, read-only source references related to the selected component.</p><ul><li>You can inspect matching source files when they are available locally.</li><li>Source references are documentation until the installed build and source revision are verified as an exact match.</li></ul>` }
    ,deviceStudioOverlayDiagnosticsTab: { title:"Diagnostics", body:`<p>Shows the latest safe diagnostic information and firmware-safe actions for the selected component.</p><ul><li>It reports available actions, their expected duration and safety level.</li><li>This tab does not perform an action by itself.</li></ul>` }
    ,deviceStudioOverlayHistoryTab: { title:"History", body:`<p>Shows recent local Device Studio observations for the selected component.</p><ul><li>Use it to compare the current reported state with earlier diagnostic snapshots.</li><li>History stays local to this app.</li></ul>` }
    ,engineeringModeHelp: { title:"Engineering Mode", body:`<p>Provides a shared, local context signal for optional advanced engineering features.</p><ul><li>It is disabled by default.</li><li>Enabling it currently does not change parser output, viewer content, stored data or device actions.</li><li>Future modules can check the context and define their own reviewed Engineering Mode behaviour.</li><li>Disable it in Settings to return every participating module to Standard Mode.</li></ul>` }
    ,navigationGuideHelp: { title:"Navigation guide", body:`<p>Each tab opens a different workspace. The tabs do not perform an action by themselves; they only take you to the related tools.</p><div class="helpNavigationGrid"><div><b>Workshop</b><span>Starting point. Choose a workspace and begin a guided workflow.</span></div><div><b>Collection</b><span>Browse, search, import and export your saved RFID records.</span></div><div><b>RFID Tag</b><span>Create or edit one record, photos and backup references.</span></div><div><b>Device Console</b><span>Connect to the Proxmark3, run commands and read output. With Safe Mode off, authorised advanced PM3 commands can be entered manually; Electron does not provide a guided cloning workflow.</span></div><div><b>Device Studio</b><span>Explore the connected board with safe, read-only diagnostics and component explanations.</span></div><div><b>Restore Helper</b><span>Generate reviewable restore commands from registered backup information.</span></div><div><b>Compare</b><span>Compare registered backups or manually selected dump files.</span></div><div><b>Labels</b><span>Preview and print labels for saved RFID tags.</span></div><div><b>Scan / Intelligence</b><span>Run the guided scan, detection, explanation and report workflow.</span></div><div><b>Research</b><span>Review or improve Electron's local knowledge about a card.</span></div><div><b>Electron Portal</b><span>Preview, support and feedback information. Nothing is shared automatically.</span></div><div><b>History</b><span>Review saved observations and earlier activity.</span></div><div><b>Change Log</b><span>See what changed in local RFID records and when.</span></div></div><p><b>Tip:</b> Hover over any tab for a short reminder before opening it.</p>` }
  };

  function iconsEnabled(){
    try{ return (localStorage.getItem(STORAGE_KEY) ?? "true") === "true"; }
    catch{ return true; }
  }

  function setIconsEnabled(enabled){
    try{ localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false"); }catch{}
    applyVisibility();
  }

  function applyVisibility(){
    const show = iconsEnabled();
    document.querySelectorAll(".helpInfoIcon,.sectionHelpIcon").forEach(icon=>{
      icon.style.display = show ? "" : "none";
    });
    const checkbox=document.getElementById("showHelpEngineIcons");
    if(checkbox) checkbox.checked=show;
  }

  function closeHelp(){
    const old=document.getElementById("helpEngineOverlay");
    if(old) old.remove();
  }

  function escapeHtml(value){
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function showHelp(key){
    const topic=helpTopics[key];
    if(!topic) return;

    closeHelp();

    const overlay=document.createElement("div");
    overlay.id="helpEngineOverlay";
    overlay.className="helpEngineOverlay";

    const card=document.createElement("div");
    card.className="helpEngineCard";
    card.innerHTML=`
      <div class="helpEngineHeader">
        <h3>${escapeHtml(topic.title)}</h3>
        <button id="helpEngineCloseBtn">Close</button>
      </div>
      <div class="helpEngineBody">${topic.body}</div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById("helpEngineCloseBtn").onclick=closeHelp;
    overlay.onclick=e=>{ if(e.target===overlay) closeHelp(); };
  }

  function svgIcon(){
    return `
<svg viewBox="0 0 20 20" aria-hidden="true">
  <circle cx="10" cy="10" r="7.2"></circle>
  <text x="10" y="13.6" text-anchor="middle">i</text>
</svg>`;
  }

  function attachHelpIcon(target, key){
      if(!target) return;
      if(target.dataset.helpAttached === key) return;
      if(target.classList?.contains("no-auto-help-icon")) return;
      const build=window.ElectronAppConfig?.BUILD_CONFIG || window.ElectronBuildConfig || {};
      if(target.dataset.internalTool === "true" && build.HIDE_INTERNAL_TOOLS) return;
      if(target.closest(".helpButtonWrap")) return;
      if(target.classList?.contains("sectionHelpIcon")) return;

      const wrapper=document.createElement("span");
      wrapper.className="helpButtonWrap";
      target.parentNode.insertBefore(wrapper,target);
      wrapper.appendChild(target);

      const icon=document.createElement("button");
      icon.type="button";
      icon.className="helpInfoIcon";
      icon.innerHTML=svgIcon();
      icon.title="What does this do?";
      icon.dataset.helpKey=key;
      wrapper.appendChild(icon);

      target.dataset.helpAttached=key;
  }

  function attachHelpIcons(){
    Object.entries(helpTopics).forEach(([key,topic])=>{
      const targets=topic.selector ? document.querySelectorAll(topic.selector) : [document.getElementById(key)];
      targets.forEach(target=>attachHelpIcon(target, key));
    });

    applyVisibility();
  }

  function setupSettingsCheckbox(){
    const checkbox=document.getElementById("showHelpEngineIcons");
    if(!checkbox || checkbox.dataset.helpEngineBound === "true") return;
    checkbox.checked=iconsEnabled();
    checkbox.onchange=()=>setIconsEnabled(checkbox.checked);
    checkbox.dataset.helpEngineBound="true";
  }

  document.addEventListener("click", e=>{
    const btn=e.target.closest("[data-help-key]");
    if(!btn) return;
    e.preventDefault();
    e.stopPropagation();
    showHelp(btn.dataset.helpKey);
  });

  function refresh(){
    attachHelpIcons();
    setupSettingsCheckbox();
    applyVisibility();
  }

  window.HelpEngine={
    refresh,
    attach:attachHelpIcons,
    show:showHelp,
    close:closeHelp,
    setIconsEnabled,
    iconsEnabled,
    applyVisibility
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", refresh);
  }else{
    refresh();
  }

  const observer=new MutationObserver(()=>refresh());
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
