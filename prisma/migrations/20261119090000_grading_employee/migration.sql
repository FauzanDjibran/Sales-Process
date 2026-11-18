-- P286: the Karyawan who graded (optional, several), as the artifact grading form records them (T6).
CREATE TABLE "prd_grading_employee" (
  "id" SERIAL NOT NULL,
  "grading_id" INTEGER NOT NULL,
  "employee_id" INTEGER NOT NULL,
  CONSTRAINT "prd_grading_employee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_grading_employee_grading_id_employee_id_key" ON "prd_grading_employee"("grading_id", "employee_id");
ALTER TABLE "prd_grading_employee" ADD CONSTRAINT "prd_grading_employee_grading_id_fkey" FOREIGN KEY ("grading_id") REFERENCES "prd_grading"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_grading_employee" ADD CONSTRAINT "prd_grading_employee_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "m_employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
