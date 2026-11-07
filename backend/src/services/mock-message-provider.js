export function createMockMessageProvider(auditLog = console.info) {
  return {
    async send(message) {
      auditLog({
        event: 'mock_message.accepted',
        reminderId: message.reminderId,
        studentId: message.studentId,
        installmentId: message.installmentId,
        language: message.language
      });
      return { accepted: true, provider: 'mock' };
    }
  };
}
