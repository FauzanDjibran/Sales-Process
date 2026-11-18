/** A row a production document may take: one Job, or one No. Stok without a Job (offered by `InputBar`). */
export type JobChoice = { key: string; jobNo: string | null; lotNo: string; itemName: string; count: number; partaiId: number | null; partaiNo: string | null; grams: number };
