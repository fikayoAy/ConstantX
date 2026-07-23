# Plan Graph

## B-001 Data Pipeline and Preprocessing
Status: implemented
Depends on: none
Related blocks: B-002, B-003
Papers: P-001, P-002

## B-002 CNN Model Training
Status: spec_approved
Depends on: B-001
Related blocks: B-003, B-001
Papers: P-002, P-003, P-004

## B-003 Evaluation, Inference, and Run Instructions
Status: spec_approved
Depends on: B-001, B-002
Related blocks: B-001, B-002
Papers: P-001, P-002, P-005

## Edges
- B-001 --related_to--> B-002
- B-001 --related_to--> B-003
- B-002 --depends_on--> B-001
- B-002 --related_to--> B-003
- B-002 --related_to--> B-001
- B-003 --depends_on--> B-001
- B-003 --depends_on--> B-002
- B-003 --related_to--> B-001
- B-003 --related_to--> B-002
