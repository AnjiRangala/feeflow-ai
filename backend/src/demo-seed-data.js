export const DEMO_SEED_KEY = 'feeflow-ai-demo-v1';

export const demoStudents = [
  {
    studentId: 'STU-0412',
    name: 'Aarav Meena',
    batch: 'JEE 2027 Morning',
    centre: 'Jaipur Central',
    parentPhone: '+919000000412',
    parentEmail: 'parent0412@feeflow.demo',
    attendancePercentage: 94,
    testPerformance: [{ subject: 'Physics', score: 86, testDate: new Date('2026-10-20') }],
    totalFeePaise: 12000000,
    discountPaise: 0,
    installments: [
      { dueDate: '2026-10-10', amountPaise: 3000000, paidAmountPaise: 3000000, status: 'paid' },
      { dueDate: '2027-01-10', amountPaise: 3000000, paidAmountPaise: 0, status: 'upcoming' },
      { dueDate: '2027-04-10', amountPaise: 3000000, paidAmountPaise: 0, status: 'upcoming' },
      { dueDate: '2027-07-10', amountPaise: 3000000, paidAmountPaise: 0, status: 'upcoming' }
    ]
  },
  {
    studentId: 'STU-0587',
    name: 'Ishita Sharma',
    batch: 'JEE 2027 Evening',
    centre: 'Jaipur North',
    parentPhone: '+919000000587',
    parentEmail: 'parent0587@feeflow.demo',
    attendancePercentage: 89,
    testPerformance: [{ subject: 'Mathematics', score: 78, testDate: new Date('2026-10-22') }],
    totalFeePaise: 12000000,
    discountPaise: 600000,
    installments: [
      { dueDate: '2026-10-10', amountPaise: 2850000, paidAmountPaise: 1500000, status: 'partially_paid' },
      { dueDate: '2027-01-10', amountPaise: 2850000, paidAmountPaise: 0, status: 'upcoming' },
      { dueDate: '2027-04-10', amountPaise: 2850000, paidAmountPaise: 0, status: 'upcoming' },
      { dueDate: '2027-07-10', amountPaise: 2850000, paidAmountPaise: 0, status: 'upcoming' }
    ]
  },
  {
    studentId: 'STU-0219',
    name: 'Mohit Gurjar',
    batch: 'NEET 2027 Morning',
    centre: 'Ajmer Road',
    parentPhone: '+919000000219',
    parentEmail: 'parent0219@feeflow.demo',
    attendancePercentage: 91,
    testPerformance: [{ subject: 'Biology', score: 82, testDate: new Date('2026-10-25') }],
    totalFeePaise: 12000000,
    discountPaise: 0,
    installments: [
      { dueDate: '2026-11-15', amountPaise: 4000000, paidAmountPaise: 0, status: 'upcoming' },
      { dueDate: '2027-02-15', amountPaise: 4000000, paidAmountPaise: 0, status: 'upcoming' },
      { dueDate: '2027-05-15', amountPaise: 4000000, paidAmountPaise: 0, status: 'upcoming' }
    ]
  },
  {
    studentId: 'STU-0773',
    name: 'Riya Verma',
    batch: 'NEET 2027 Evening',
    centre: 'Jaipur Central',
    parentPhone: '+919000000773',
    parentEmail: 'parent0773@feeflow.demo',
    attendancePercentage: 65,
    testPerformance: [
      { subject: 'Biology', score: 76, testDate: new Date('2026-09-10') },
      { subject: 'Biology', score: 66, testDate: new Date('2026-10-10') }
    ],
    paymentPromises: [
      { status: 'broken', promisedAt: new Date('2026-10-20'), resolvedAt: new Date('2026-10-25') }
    ],
    totalFeePaise: 12000000,
    discountPaise: 0,
    installments: [
      { dueDate: '2026-10-10', amountPaise: 3000000, paidAmountPaise: 0, status: 'overdue' },
      { dueDate: '2026-11-15', amountPaise: 3000000, paidAmountPaise: 0, status: 'upcoming' },
      { dueDate: '2027-02-15', amountPaise: 3000000, paidAmountPaise: 0, status: 'upcoming' },
      { dueDate: '2027-05-15', amountPaise: 3000000, paidAmountPaise: 0, status: 'upcoming' }
    ]
  }
];

export const demoParents = [
  { email: 'parent0412@feeflow.demo', studentId: 'STU-0412' },
  { email: 'parent0587@feeflow.demo', studentId: 'STU-0587' },
  { email: 'parent0773@feeflow.demo', studentId: 'STU-0773' }
];

export const demoAccountsUser = {
  email: 'accounts@feeflow.demo',
  role: 'accounts',
  studentId: null
};

export const demoCounsellorUser = {
  email: 'counsellor@feeflow.demo',
  role: 'counsellor',
  studentId: null
};

export function createDemoFeePlanData(student) {
  const netFeePaise = student.totalFeePaise - student.discountPaise;
  return {
    demoSeedKey: DEMO_SEED_KEY,
    studentId: student.studentId,
    totalFeePaise: student.totalFeePaise,
    discountPaise: student.discountPaise,
    netFeePaise,
    numberOfInstallments: student.installments.length,
    installments: student.installments.map((installment, index) => ({
      installmentNumber: index + 1,
      dueDate: new Date(`${installment.dueDate}T00:00:00.000Z`),
      amountPaise: installment.amountPaise,
      paidAmountPaise: installment.paidAmountPaise,
      status: installment.status,
      payments: []
    }))
  };
}
