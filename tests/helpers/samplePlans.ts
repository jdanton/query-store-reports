/** Single Clustered Index Scan — simplest valid plan with Object element */
export const SIMPLE_SCAN_PLAN = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.2">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM Users">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan"
                   EstimateRows="1000" EstimateCPU="0.01" EstimateIO="0.05"
                   EstimateRebinds="0" EstimateRewinds="0" EstimateExecutions="1"
                   AvgRowSize="100" TotalSubtreeCost="0.06" Parallel="0">
              <IndexScan>
                <Object Schema="[dbo]" Table="[Users]" Index="[PK_Users]" />
              </IndexScan>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

/** Nested Loop Join with two children — tests tree, edges, multiple nodes */
export const NESTED_LOOP_PLAN = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.2">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT o.* FROM Orders o JOIN Users u ON o.user_id = u.id">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join"
                   EstimateRows="500" EstimateCPU="0.002" EstimateIO="0"
                   EstimateRebinds="0" EstimateRewinds="0" EstimateExecutions="1"
                   AvgRowSize="200" TotalSubtreeCost="0.15" Parallel="0">
              <NestedLoops>
                <RelOp NodeId="1" PhysicalOp="Index Seek" LogicalOp="Index Seek"
                       EstimateRows="500" EstimateCPU="0.005" EstimateIO="0.03"
                       EstimateRebinds="0" EstimateRewinds="0" EstimateExecutions="1"
                       AvgRowSize="150" TotalSubtreeCost="0.035" Parallel="0">
                  <IndexScan>
                    <Object Schema="[dbo]" Table="[Orders]" Index="[IX_Orders_UserId]" />
                  </IndexScan>
                </RelOp>
                <RelOp NodeId="2" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek"
                       EstimateRows="1" EstimateCPU="0.0001" EstimateIO="0.003"
                       EstimateRebinds="499" EstimateRewinds="0" EstimateExecutions="500"
                       AvgRowSize="100" TotalSubtreeCost="0.113" Parallel="0">
                  <IndexScan>
                    <Object Schema="[dbo]" Table="[Users]" Index="[PK_Users]" />
                  </IndexScan>
                </RelOp>
              </NestedLoops>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

/** Plan with warnings */
export const WARNINGS_PLAN = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.2">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM LargeTable">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Hash Match" LogicalOp="Inner Join"
                   EstimateRows="50000" EstimateCPU="0.5" EstimateIO="1.2"
                   EstimateRebinds="0" EstimateRewinds="0" EstimateExecutions="1"
                   AvgRowSize="300" TotalSubtreeCost="2.5" Parallel="0">
              <Hash>
                <Warnings>
                  <SpillToTempDb SpillLevel="1" />
                  <NoJoinPredicate />
                </Warnings>
                <RelOp NodeId="1" PhysicalOp="Table Scan" LogicalOp="Table Scan"
                       EstimateRows="50000" EstimateCPU="0.3" EstimateIO="0.8"
                       EstimateRebinds="0" EstimateRewinds="0" EstimateExecutions="1"
                       AvgRowSize="300" TotalSubtreeCost="1.1" Parallel="0">
                  <TableScan>
                    <Object Schema="[dbo]" Table="[LargeTable]" />
                  </TableScan>
                </RelOp>
              </Hash>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

/** Plan with parallelism */
export const PARALLEL_PLAN = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.2">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT COUNT(*) FROM HugeTable">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Stream Aggregate" LogicalOp="Aggregate"
                   EstimateRows="1" EstimateCPU="0.001" EstimateIO="0"
                   EstimateRebinds="0" EstimateRewinds="0" EstimateExecutions="1"
                   AvgRowSize="11" TotalSubtreeCost="3.0" Parallel="1">
              <StreamAggregate>
                <RelOp NodeId="1" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan"
                       EstimateRows="10000000" EstimateCPU="1.5" EstimateIO="1.0"
                       EstimateRebinds="0" EstimateRewinds="0" EstimateExecutions="1"
                       AvgRowSize="11" TotalSubtreeCost="2.5" Parallel="1">
                  <IndexScan>
                    <Object Schema="[dbo]" Table="[HugeTable]" Index="[PK_HugeTable]" />
                  </IndexScan>
                </RelOp>
              </StreamAggregate>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

/** Invalid XML — parsePlan should return null */
export const INVALID_XML = `<not valid xml`;

/** Valid XML but no RelOp element — parsePlan should return null */
export const NO_RELOP_XML = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple>
          <QueryPlan>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;
