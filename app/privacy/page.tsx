export const metadata = {
  title: "Privacy Policy — Busy Bees Toolbar",
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "48px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
      <h1>Busy Bees Toolbar — Privacy Policy</h1>
      <p><em>Last updated: July 23, 2026</em></p>
      <p>The Busy Bees Toolbar is an internal Chrome extension used exclusively by authorized Busy Bees Senior Care staff. It collects and processes the following data solely to provide scheduling functionality:</p>
      <ul>
        <li>Authentication credentials (username and password) to verify staff identity via Firebase Authentication</li>
        <li>Scheduling data (shifts, availability, caregiver assignments) read from and written to Busy Bees Senior Care's Firestore database</li>
        <li>Messaging content sent through the toolbar's messaging feature</li>
      </ul>
      <p>Data is not sold, shared with third parties, or used for advertising. All data remains within Busy Bees Senior Care's Firebase infrastructure. Access is restricted to authenticated staff members with appropriate roles.</p>
      <p>Questions: <a href="mailto:tyler@busybeeseniorcare.com">tyler@busybeeseniorcare.com</a></p>
    </main>
  );
}
