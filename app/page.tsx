export default function Home() {
  return (
    <main style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22 }}>FOMO app requests</h1>
      <p>Ask for a change to one of the team&apos;s apps by posting in Slack <strong>#app-requests</strong>. Claude asks a few questions in the thread, then a small fix is built for Sam to check, and anything bigger goes to Jamie as a proposal.</p>
    </main>
  );
}
