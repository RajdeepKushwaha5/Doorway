export default function ControlledApplicationPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto' }}>
      <p style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        Doorway Lab / Controlled application
      </p>
      <h1>Application route verified</h1>
      <p>
        This is a controlled fixture. It proves that the extracted application link reaches the
        intended programme, but it does not accept or store an application.
      </p>
      <a href="/opportunity/ai-fellowship">Return to the programme</a>
    </main>
  );
}
