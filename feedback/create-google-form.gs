// ══════════════════════════════════════════════════════════════
// HOW TO USE:
// 1. Go to https://script.google.com
// 2. Click "New Project"
// 3. Paste this entire file into the editor (replace the default code)
// 4. Click ▶ Run → select "createFeedbackForm" → click Run
// 5. It will ask for permissions — click Allow
// 6. Check the Execution Log — you'll see the form URL
// 7. Share that URL with your team!
//
// Responses automatically go to a connected Google Sheet.
// ══════════════════════════════════════════════════════════════

function createFeedbackForm() {
  const form = FormApp.create('Advanced Salesforce Developer Toolkit — Feedback');
  form.setDescription(
    'Help us improve! This anonymous survey takes about 2 minutes.\n\n' +
    '🔒 100% Anonymous — No login required\n\n' +
    'Extension: https://chromewebstore.google.com/detail/advanced-salesforce-devel/dmaijjgogckglbleglkplaihlmjbhgif'
  );
  form.setIsQuiz(false);
  form.setCollectEmail(false);        // Anonymous
  form.setAllowResponseEdits(false);

  // ─── Q1: Installed? ───
  const q1 = form.addMultipleChoiceItem();
  q1.setTitle('1. Have you installed the extension?')
    .setChoices([
      q1.createChoice('Yes, actively using it'),
      q1.createChoice('Yes, tried it once'),
      q1.createChoice('Installed but haven\'t used yet'),
      q1.createChoice('No, haven\'t installed')
    ])
    .setRequired(true);

  // ─── Q2: Features used ───
  const q2 = form.addCheckboxItem();
  q2.setTitle('2. Which features have you used? (select all that apply)')
    .setHelpText('Skip if you haven\'t used the extension yet')
    .setChoices([
      q2.createChoice('🔍 Global Search (Cmd+Shift+P)'),
      q2.createChoice('🔎 Record Inspector (Cmd+Shift+X)'),
      q2.createChoice('📝 SOQL Editor (Cmd+Shift+L)'),
      q2.createChoice('🚀 Quick Navigator (Cmd+Shift+Y)'),
      q2.createChoice('🐛 Debug Log Analyzer'),
      q2.createChoice('⚡ Execute Anonymous'),
    ])
    .setRequired(false);

  // ─── Q3: Most useful ───
  const q3 = form.addMultipleChoiceItem();
  q3.setTitle('3. Which feature is MOST useful to you?')
    .setHelpText('Pick the one you\'d miss most if it was removed')
    .setChoices([
      q3.createChoice('🔍 Global Search'),
      q3.createChoice('🔎 Record Inspector'),
      q3.createChoice('📝 SOQL Editor'),
      q3.createChoice('🚀 Quick Navigator'),
      q3.createChoice('🐛 Debug Log Analyzer'),
      q3.createChoice('⚡ Execute Anonymous'),
      q3.createChoice('Other')
    ])
    .setRequired(false);

  // ─── Q4: Time saved ───
  const q4 = form.addMultipleChoiceItem();
  q4.setTitle('4. How much time does it save you per day?')
    .setChoices([
      q4.createChoice('Not using it yet'),
      q4.createChoice('A few minutes'),
      q4.createChoice('15–30 minutes'),
      q4.createChoice('30–60 minutes'),
      q4.createChoice('More than 1 hour')
    ])
    .setRequired(false);

  // ─── Q5: Role ───
  const q5 = form.addMultipleChoiceItem();
  q5.setTitle('5. What\'s your role?')
    .setChoices([
      q5.createChoice('Developer'),
      q5.createChoice('Admin'),
      q5.createChoice('QA / Tester'),
      q5.createChoice('Architect'),
      q5.createChoice('Manager'),
      q5.createChoice('Other')
    ])
    .setRequired(true);

  // ─── Q6: Rating ───
  form.addScaleItem()
    .setTitle('6. Rate the overall experience')
    .setHelpText('1 = Poor, 5 = Excellent')
    .setBounds(1, 5)
    .setRequired(true);

  // ─── Q7: Bugs ───
  form.addParagraphTextItem()
    .setTitle('7. Any issues or bugs you\'ve encountered?')
    .setHelpText('Describe what happened and which feature was involved')
    .setRequired(false);

  // ─── Q8: Feature requests ───
  form.addParagraphTextItem()
    .setTitle('8. What feature would you add or improve?')
    .setHelpText('What\'s missing? What would make this a daily-use tool for you?')
    .setRequired(false);

  // ─── Q9: Recommend ───
  form.addScaleItem()
    .setTitle('9. How likely are you to recommend this to a colleague?')
    .setHelpText('1 = Not at all, 10 = Absolutely')
    .setBounds(1, 10)
    .setRequired(true);

  // ─── Q10: Anything else ───
  form.addParagraphTextItem()
    .setTitle('10. Anything else you\'d like to share?')
    .setHelpText('General thoughts, comparisons with other tools, suggestions...')
    .setRequired(false);

  // ─── Create linked spreadsheet for responses ───
  const ss = SpreadsheetApp.create('SFDT Feedback Responses');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // ─── Log the URLs ───
  const formUrl = form.getPublishedUrl();
  const editUrl = form.getEditUrl();
  const sheetUrl = ss.getUrl();

  Logger.log('═══════════════════════════════════════════');
  Logger.log('✅ FORM CREATED SUCCESSFULLY!');
  Logger.log('');
  Logger.log('📋 Share this URL with your team:');
  Logger.log(formUrl);
  Logger.log('');
  Logger.log('✏️  Edit the form:');
  Logger.log(editUrl);
  Logger.log('');
  Logger.log('📊 View responses (Google Sheet):');
  Logger.log(sheetUrl);
  Logger.log('═══════════════════════════════════════════');
}
