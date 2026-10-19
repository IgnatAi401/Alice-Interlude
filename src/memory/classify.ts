/**
 * Privacy classification rules from dev/ROADMAP.md §4.3. Shared by the main
 * narrator and the compactor; it sits in the fixed prompt layer so it never
 * breaks the cache prefix.
 */
export const AUDIENCE_CLASSIFICATION_RULES = [
  'MEMORY AUDIENCE (fixed by the bot): every memories item, fact and state patch you write carries "audience":"private" or "audience":"public". Anything labelled public may later be shown to strangers on a public website or channel.',
  'Use "private" if ANY of these applies:',
  '1. Information that could identify or locate the owner in real life: real name, address, any location more specific than a city, school, workplace, phone, email, any account, ID documents, recognisable features in photos.',
  '2. The owner\'s schedule, real-time whereabouts or routines (e.g. "he is home alone tonight").',
  '3. Health, body, mental state, or anything confided while feeling low.',
  '4. Finances, income, spending details.',
  '5. Anything about family, friends, partners or any other third party, including other chat participants and API visitors.',
  '6. Intimate content between the owner and the protagonist, private agreements, in-jokes or pet names that belong only to the two of them.',
  '7. Anything the owner asked to keep secret.',
  '8. Anything on the computer: files, commands, outputs, project internals, keys.',
  '9. Anything you are unsure about.',
  'Use "public" only for: the protagonist\'s own life, thoughts and experiences (without the private details above); the owner\'s broad interests (e.g. "he likes cats"); work or opinions the owner has already made public; the bare fact that the protagonist has a close owner.',
  'When in doubt, choose "private". A missing or invalid audience is stored as private.',
].join('\n')
