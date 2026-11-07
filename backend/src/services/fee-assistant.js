import { getStudentLedgers, summarizeLedgers } from './fee-ledger.js';

const questionPatterns = {
  overdue: /\b(overdue|late|past due)\b/i,
  collected: /\b(collected|collection|collections|received|paid)\b/i,
  billed: /\b(billed|total fees|course fees)\b/i
};

function normalize(value) {
  return value.toLocaleLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

function findStudent(question, students) {
  const normalizedQuestion = normalize(question);
  const matches = students.filter(({ studentId, name }) =>
    normalizedQuestion.includes(normalize(studentId)) ||
    normalizedQuestion.includes(normalize(name))
  );
  if (!matches.length) return { student: null, ambiguous: false };
  const longestMatchLength = Math.max(...matches.map(({ name, studentId }) => Math.max(name.length, studentId.length)));
  const longestMatches = matches.filter(({ name, studentId }) =>
    Math.max(name.length, studentId.length) === longestMatchLength
  );
  return longestMatches.length === 1
    ? { student: longestMatches[0], ambiguous: false }
    : { student: null, ambiguous: true };
}

function result(label, amountPaise) {
  return { label, amountPaise };
}

export async function answerFeeQuestion(models, question) {
  const students = await models.Student.find({ isActive: true }).sort({ name: 1 }).lean();
  const ledgers = await getStudentLedgers(models, students);
  const normalizedQuestion = normalize(question);
  const studentMatch = findStudent(question, students);

  if (studentMatch.ambiguous) {
    return {
      type: 'clarification',
      answer: 'More than one student matched that name. Please include the student ID.',
      results: []
    };
  }

  if (studentMatch.student) {
    const ledger = ledgers.find(({ student }) => student.studentId === studentMatch.student.studentId);
    if (!ledger.feePlan) {
      return {
        type: 'student',
        answer: `${ledger.student.name} (${ledger.student.studentId}) has no fee plan or recorded balance.`,
        results: []
      };
    }

    return {
      type: 'student',
      answer: `Fee ledger for ${ledger.student.name} (${ledger.student.studentId}).`,
      results: [
        result('Outstanding', ledger.remainingBalancePaise),
        result('Paid', ledger.amountPaidPaise),
        result('Net fee', ledger.feePlan.netFeePaise),
        result('Overdue', ledger.feePlan.installments
          .filter(({ status }) => status === 'overdue')
          .reduce((total, installment) => total + installment.outstandingPaise, 0))
      ]
    };
  }

  const grouping = normalizedQuestion.match(/\b(?:by|per)\s+(centre|center|batch)\b/)?.[1] ??
    normalizedQuestion.match(/\b(centre|center|batch)[ -]wise\b/)?.[1];
  if (grouping) {
    const isBatch = grouping === 'batch';
    const key = isBatch ? 'batch' : 'centre';
    const metric = Object.entries(questionPatterns).find(([, pattern]) => pattern.test(question))?.[0] ?? 'outstanding';
    const label = metric === 'overdue' ? 'Overdue' :
      metric === 'collected' ? 'Collected' :
        metric === 'billed' ? 'Billed' : 'Outstanding';
    const grouped = new Map();
    for (const ledger of ledgers) {
      if (!ledger.feePlan) continue;
      const name = ledger.student[key] || 'Unassigned';
      const amount = metric === 'overdue'
        ? ledger.feePlan.installments
          .filter(({ status }) => status === 'overdue')
          .reduce((total, installment) => total + installment.outstandingPaise, 0)
        : metric === 'collected'
          ? ledger.amountPaidPaise
          : metric === 'billed'
            ? ledger.feePlan.totalFeePaise
            : ledger.remainingBalancePaise;
      grouped.set(name, (grouped.get(name) ?? 0) + amount);
    }
    return {
      type: metric,
      answer: `${label} fees by ${isBatch ? 'batch' : 'centre'}, highest amount first.`,
      results: [...grouped]
        .sort(([leftName, leftAmount], [rightName, rightAmount]) =>
          rightAmount - leftAmount || leftName.localeCompare(rightName))
        .map(([name, amountPaise]) => result(name, amountPaise))
    };
  }

  const summary = summarizeLedgers(ledgers);
  if (questionPatterns.overdue.test(question)) {
    return {
      type: 'overdue',
      answer: 'Outstanding amount on instalments currently overdue.',
      results: [result('Overdue', summary.overdueAmountPaise)]
    };
  }
  if (questionPatterns.collected.test(question)) {
    return {
      type: 'collected',
      answer: 'Total completed payments recorded against active fee plans.',
      results: [
        result('Collected', summary.totalFeesCollectedPaise),
        { label: 'Collection rate', value: summary.collectionPercentage }
      ]
    };
  }
  if (questionPatterns.billed.test(question)) {
    return {
      type: 'billed',
      answer: 'Total course fees billed across active fee plans, before discounts.',
      results: [result('Total fees billed', summary.totalFeesBilledPaise)]
    };
  }
  if (/\b(outstanding|balance|balances|dues|due|owe|owing|remaining)\b/i.test(question)) {
    return {
      type: 'outstanding',
      answer: 'Total remaining balance across active fee plans.',
      results: [result('Outstanding', summary.totalOutstandingPaise)]
    };
  }

  return {
    type: 'unsupported',
    answer: 'I can answer questions about outstanding or overdue fees, collections, billed fees, centre or batch dues, and a named student’s balance. Please try one of those.',
    results: []
  };
}
