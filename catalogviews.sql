

CREATE VIEW sys.query_store_plan
AS
SELECT plan_id
	,query_id
	,plan_group_id
	,convert(NVARCHAR(32), REPLACE(STR((engine_version & 0xFF00000000) / 0x100000000), ' ', '') + '.' + REPLACE(STR((engine_version & 0xFF000000) / 0x1000000), ' ', '') + '.' + REPLACE(STR((engine_version & 0xFFFF00) / 0x100), ' ', '') + '.' + REPLACE(STR(engine_version & 0xFF), ' ', '')) AS engine_version
	,compatibility_level
	,query_plan_hash
	,cast(showplanxmldecompress(query_plan) AS NVARCHAR(max)) AS query_plan
	,is_online_index_plan
	,is_trivial_plan
	,is_parallel_plan
	,is_forced_plan
	,is_natively_compiled
	,force_failure_count
	,last_force_failure_reason
	,convert(NVARCHAR(128), CASE last_force_failure_reason
			WHEN 0
				THEN N'NONE'
			WHEN NULL
				THEN N'NONE'
			WHEN 3617
				THEN N'COMPILATION_ABORTED_BY_CLIENT'
			WHEN 8637
				THEN N'ONLINE_INDEX_BUILD'
			WHEN 8675
				THEN N'OPTIMIZATION_REPLAY_FAILED'
			WHEN 8683
				THEN N'INVALID_STARJOIN'
			WHEN 8684
				THEN N'TIME_OUT'
			WHEN 8689
				THEN N'NO_DB'
			WHEN 8690
				THEN N'HINT_CONFLICT'
			WHEN 8691
				THEN N'SETOPT_CONFLICT'
			WHEN 8694
				THEN N'DQ_NO_FORCING_SUPPORTED'
			WHEN 8698
				THEN N'NO_PLAN'
			WHEN 8712
				THEN N'NO_INDEX'
			WHEN 8713
				THEN N'VIEW_COMPILE_FAILED'
			ELSE N'GENERAL_FAILURE'
			END) COLLATE Latin1_General_CI_AS_KS_WS AS last_force_failure_reason_desc
	,count_compiles
	,initial_compile_start_time
	,last_compile_start_time
	,last_execution_time
	,CASE 
		WHEN count_compiles = 0
			THEN NULL
		ELSE convert(FLOAT, total_compile_duration) / count_compiles
		END AS avg_compile_duration
	,last_compile_duration
	,plan_forcing_type
	,p.name AS plan_forcing_type_desc
	,has_compile_replay_script
	,is_optimized_plan_forcing_disabled
	,plan_type
	,t.name AS plan_type_desc
FROM sys.plan_persist_plan_merged
LEFT JOIN sys.syspalvalues p ON p.class = 'PFT'
	AND p.value = plan_forcing_type
LEFT JOIN sys.syspalvalues t ON t.class = 'PTD'
	AND t.value = plan_type

CREATE VIEW sys.query_store_plan_feedback
AS
SELECT plan_feedback_id
	,plan_id
	,feature_id
	,feature_desc
	,feedback_data_json(feature_id, feedback_data) AS feedback_data
	,STATE
	,state_desc
	,create_time
	,last_updated_time
	,replica_group_id
FROM sys.plan_persist_plan_feedback_in_memory
WHERE plan_feedback_id < - 1

UNION ALL

SELECT PF.plan_feedback_id
	,PF.plan_id
	,PF.feature_id
	,convert(NVARCHAR(60), CASE PF.feature_id
			WHEN 1
				THEN 'CE Feedback' 
					-- CE Feedback     WHEN 2 THEN 'Memory Grant Feedback' -- MG Feedback     WHEN 3 THEN 'DOP Feedback'   -- DOP Feedback     WHEN 4 THEN 'LAQ Feedback'   -- LAQ Feedback     ELSE 'Invalid Feedback'     END) COLLATE Latin1_General_CI_AS_KS_WS as feature_desc,    IIF(PFM.feedback_data is NULL,     feedback_data_json(PF.feature_id, PF.feedback_data),     feedback_data_json(PFM.feature_id, PFM.feedback_data)) as feedback_data,    IIF(PFM.state is NULL, PF.state, PFM.state) as state,    convert(nvarchar(60), CASE PF.state     WHEN 0 THEN 'NO_FEEDBACK'     WHEN 1 THEN 'NO_RECOMMENDATION'     WHEN 2 THEN 'PENDING_VALIDATION'     when 3 THEN 'IN_VALIDATION'     WHEN 4 THEN 'VERIFICATION_REGRESSED'     WHEN 5 THEN 'VERIFICATION_PASSED'     WHEN 6 THEN 'ROLLEDBACK_BY_APRC'     WHEN 7 THEN 'FEEDBACK_VALID'     WHEN 8 THEN 'FEEDBACK_INVALID'     ELSE 'INVALID_VALUE'     END) COLLATE Latin1_General_CI_AS_KS_WS as state_desc,    PF.create_time,    IIF(PFM.last_updated_time is NULL, PF.last_updated_time, PFM.last_updated_time) as last_updated_time,    PF.replica_group_id   -- NOLOCK to prevent potential deadlock between QDS_STATEMENT_STABILITY lock and index locks   FROM sys.plan_persist_plan_feedback PF WITH (NOLOCK)   LEFT OUTER JOIN sys.plan_persist_plan_feedback_in_memory PFM ON    PF.plan_feedback_id = PFM.plan_feedback_id  
					CREATE VIEW sys.query_store_plan_forcing_locations
				AS
				SELECT plan_forcing_location_id
					,query_id
					,plan_id
					,replica_group_id
					,TIMESTAMP
					,plan_forcing_type
					,p.name AS plan_forcing_type_desc
				FROM (
					SELECT plan_forcing_location_id
						,query_id
						,plan_id
						,replica_group_id
						,TIMESTAMP
						,CASE 
							WHEN convert(BIT, plan_forcing_flags & 0x02) = 0
								THEN 1
							WHEN convert(BIT, plan_forcing_flags & 0x02) = 1
								THEN 2
							ELSE 0
							END AS plan_forcing_type
					FROM sys.plan_persist_plan_forcing_locations
					) AS subquery
				LEFT JOIN sys.syspalvalues p ON p.class = 'PFT'
					AND p.value = subquery.plan_forcing_type;

				CREATE VIEW sys.query_store_query
				AS
				SELECT query_id
					,query_text_id
					,context_settings_id
					,object_id
					,CAST(batch_sql_handle AS VARBINARY(44)) AS batch_sql_handle
					,query_hash
					,is_internal_query
					,query_param_type AS query_parameterization_type
					,n.name AS query_parameterization_type_desc
					,initial_compile_start_time
					,last_compile_start_time
					,last_execution_time
					,CAST(last_compile_batch_sql_handle AS VARBINARY(44)) AS last_compile_batch_sql_handle
					,last_compile_batch_offset_start
					,last_compile_batch_offset_end
					,compile_count AS count_compiles
					,CASE 
						WHEN compile_count = 0
							THEN NULL
						ELSE convert(FLOAT, total_compile_duration) / compile_count
						END AS avg_compile_duration
					,last_compile_duration
					,CASE 
						WHEN compile_count = 0
							THEN NULL
						ELSE convert(FLOAT, total_bind_duration) / compile_count
						END AS avg_bind_duration
					,last_bind_duration
					,CASE 
						WHEN compile_count = 0
							THEN NULL
						ELSE convert(FLOAT, total_bind_cpu_time) / compile_count
						END AS avg_bind_cpu_time
					,last_bind_cpu_time
					,CASE 
						WHEN compile_count = 0
							THEN NULL
						ELSE convert(FLOAT, total_optimize_duration) / compile_count
						END AS avg_optimize_duration
					,last_optimize_duration
					,CASE 
						WHEN compile_count = 0
							THEN NULL
						ELSE convert(FLOAT, total_optimize_cpu_time) / compile_count
						END AS avg_optimize_cpu_time
					,last_optimize_cpu_time
					,CASE 
						WHEN compile_count = 0
							THEN NULL
						ELSE convert(FLOAT, total_compile_memory_kb) / compile_count
						END AS avg_compile_memory_kb
					,last_compile_memory_kb
					,max_compile_memory_kb
					,CASE 
						WHEN STATUS IS NULL
							THEN NULL
						ELSE convert(BIT, STATUS & 0x01)
						END AS is_clouddb_internal_query
				FROM sys.plan_persist_query_merged
				LEFT JOIN sys.syspalvalues n ON n.class = 'QDPT'
					AND n.value = query_param_type

				CREATE VIEW sys.query_store_query_hints
				AS
				SELECT QH.query_hint_id
					,QH.query_id
					,QH.replica_group_id
					,QH.query_hints AS query_hint_text
					,QH.last_query_hint_failure_reason
					,convert(NVARCHAR(128), CASE QH.last_query_hint_failure_reason
							WHEN 0
								THEN N'NONE'
							WHEN NULL
								THEN N'NONE'
							WHEN 309
								THEN N'XMLIDX_IN_HINTS'
							WHEN 321
								THEN N'INVALID_TABLE_HINT'
							WHEN 1017
								THEN N'DUPLICATE_HINTS'
							WHEN 1042
								THEN N'CONFLICTING_OPTIMIZER_HINTS'
							WHEN 1047
								THEN N'CONFLICTING_LOCKING_HINTS'
							WHEN 8622
								THEN N'NO_PLAN'
							ELSE N'GENERAL_FAILURE'
							END) COLLATE Latin1_General_CI_AS_KS_WS AS last_query_hint_failure_reason_desc
					,QH.query_hint_failure_count
					,QH.query_hints_flags AS source
					,convert(NVARCHAR(128), CASE QH.query_hints_flags
							WHEN 1
								THEN 'CE feedback' -- HS_CEFeedback     WHEN 2 THEN 'DOP feedback'  -- HS_DOPFeedback     ELSE 'User'     END) COLLATE Latin1_General_CI_AS_KS_WS as source_desc,    QH.comment   -- NOLOCK to prevent potential deadlock between QDS_STATEMENT_STABILITY lock and index locks   FROM sys.plan_persist_query_hints QH WITH (NOLOCK)   -- join with STVF enables view to have same security definitions as STVF; plan will remove it since it is empty table   LEFT OUTER JOIN (    SELECT TOP 0      query_hint_id,     query_id,     query_hints_flags    FROM OpenRowset(TABLE QUERY_STORE_QUERY_HINTS_IN_MEM)) QHM ON   QHM.query_hint_id = QH.query_hint_id  
									CREATE VIEW sys.query_store_query_text
								AS
								SELECT query_text_id AS query_text_id
									,query_sql_text COLLATE SQL_Latin1_General_CP1_CI_AS AS query_sql_text
									,CAST(statement_sql_handle AS VARBINARY(44)) AS statement_sql_handle
									,is_part_of_encrypted_module AS is_part_of_encrypted_module
									,has_restricted_text AS has_restricted_text
								FROM sys.plan_persist_query_text_in_memory
								WHERE query_text_id < - 1
								
								UNION ALL
								
								SELECT qt.query_text_id
									,qt.query_sql_text
									,CAST(qt.statement_sql_handle AS VARBINARY(44)) AS statement_sql_handle
									,qt.is_part_of_encrypted_module
									,qt.has_restricted_text
								FROM sys.plan_persist_query_text qt WITH (NOLOCK) -- NOTE - in order to prevent potential deadlock between QDS_STATEMENT_STABILITY LOCK and index locks    LEFT OUTER JOIN (     SELECT TOP 0       query_text_id,      query_sql_text,      CAST(statement_sql_handle AS VARBINARY(44)) AS statement_sql_handle,      is_part_of_encrypted_module,      has_restricted_text     FROM sys.plan_persist_query_text_in_memory) qt_in_mem ON -- NOTE - join with STVF will enable view to have same security definitions as STVF    qt_in_mem.query_text_id = qt.query_text_id      --    but plan will remove it since it is empty table  

								CREATE VIEW sys.query_store_query_variant
								AS
								SELECT QM.query_variant_query_id
									,QM.parent_query_id
									,QM.dispatcher_plan_id
								FROM sys.plan_persist_query_variant_in_memory QM
								WHERE query_variant_query_id < - 1
								
								UNION ALL
								
								SELECT QV.query_variant_query_id
									,QV.parent_query_id
									,QV.dispatcher_plan_id -- NOLOCK to prevent potential deadlock between QDS_STATEMENT_STABILITY lock and index locks   FROM sys.plan_persist_query_variant QV WITH (NOLOCK)   LEFT OUTER JOIN (    SELECT TOP 0      query_variant_query_id, parent_query_id, dispatcher_plan_id    FROM sys.plan_persist_query_variant_in_memory) QVM ON   QVM.query_variant_query_id = QV.query_variant_query_id  

								CREATE VIEW sys.query_store_replicas
								AS
								SELECT replica_group_id
									,role_type
									,replica_name
								FROM sys.plan_persist_replicas

								CREATE VIEW sys.query_store_runtime_stats
								AS
								SELECT runtime_stats_id
									,plan_id
									,runtime_stats_interval_id
									,execution_type
									,n.name AS execution_type_desc
									,first_execution_time
									,last_execution_time
									,count_executions
									,avg_duration
									,last_duration
									,min_duration
									,max_duration
									,CASE 
										WHEN sqdiff_duration >= 0
											THEN sqrt(sqdiff_duration)
										ELSE NULL
										END AS stdev_duration
									,avg_cpu_time
									,last_cpu_time
									,min_cpu_time
									,max_cpu_time
									,CASE 
										WHEN sqdiff_cpu_time >= 0
											THEN sqrt(sqdiff_cpu_time)
										ELSE NULL
										END AS stdev_cpu_time
									,avg_logical_io_reads
									,last_logical_io_reads
									,min_logical_io_reads
									,max_logical_io_reads
									,CASE 
										WHEN sqdiff_logical_io_reads >= 0
											THEN sqrt(sqdiff_logical_io_reads)
										ELSE NULL
										END AS stdev_logical_io_reads
									,avg_logical_io_writes
									,last_logical_io_writes
									,min_logical_io_writes
									,max_logical_io_writes
									,CASE 
										WHEN sqdiff_logical_io_writes >= 0
											THEN sqrt(sqdiff_logical_io_writes)
										ELSE NULL
										END AS stdev_logical_io_writes
									,avg_physical_io_reads
									,last_physical_io_reads
									,min_physical_io_reads
									,max_physical_io_reads
									,CASE 
										WHEN sqdiff_physical_io_reads >= 0
											THEN sqrt(sqdiff_physical_io_reads)
										ELSE NULL
										END AS stdev_physical_io_reads
									,avg_clr_time
									,last_clr_time
									,min_clr_time
									,max_clr_time
									,CASE 
										WHEN sqdiff_clr_time >= 0
											THEN sqrt(sqdiff_clr_time)
										ELSE NULL
										END AS stdev_clr_time
									,avg_dop
									,last_dop
									,min_dop
									,max_dop
									,CASE 
										WHEN sqdiff_dop >= 0
											THEN sqrt(sqdiff_dop)
										ELSE NULL
										END AS stdev_dop
									,avg_query_max_used_memory
									,last_query_max_used_memory
									,min_query_max_used_memory
									,max_query_max_used_memory
									,CASE 
										WHEN sqdiff_query_max_used_memory >= 0
											THEN sqrt(sqdiff_query_max_used_memory)
										ELSE NULL
										END AS stdev_query_max_used_memory
									,avg_rowcount
									,last_rowcount
									,min_rowcount
									,max_rowcount
									,CASE 
										WHEN sqdiff_rowcount >= 0
											THEN sqrt(sqdiff_rowcount)
										ELSE NULL
										END AS stdev_rowcount
									,avg_num_physical_io_reads
									,last_num_physical_io_reads
									,min_num_physical_io_reads
									,max_num_physical_io_reads
									,CASE 
										WHEN sqdiff_num_physical_io_reads >= 0
											THEN sqrt(sqdiff_num_physical_io_reads)
										ELSE NULL
										END AS stdev_num_physical_io_reads
									,avg_log_bytes_used
									,last_log_bytes_used
									,min_log_bytes_used
									,max_log_bytes_used
									,CASE 
										WHEN sqdiff_log_bytes_used >= 0
											THEN sqrt(sqdiff_log_bytes_used)
										ELSE NULL
										END AS stdev_log_bytes_used
									,avg_tempdb_space_used
									,last_tempdb_space_used
									,min_tempdb_space_used
									,max_tempdb_space_used
									,CASE 
										WHEN sqdiff_tempdb_space_used >= 0
											THEN sqrt(sqdiff_tempdb_space_used)
										ELSE NULL
										END AS stdev_tempdb_space_used
									,avg_page_server_io_reads
									,last_page_server_io_reads
									,min_page_server_io_reads
									,max_page_server_io_reads
									,CASE 
										WHEN sqdiff_page_server_io_reads >= 0
											THEN sqrt(sqdiff_page_server_io_reads)
										ELSE NULL
										END AS stdev_page_server_io_reads
									,replica_group_id
								FROM (
									SELECT *
										,round(convert(FLOAT, sumsquare_duration) / count_executions - avg_duration * avg_duration, 2) AS sqdiff_duration
										,round(convert(FLOAT, sumsquare_cpu_time) / count_executions - avg_cpu_time * avg_cpu_time, 2) AS sqdiff_cpu_time
										,round(convert(FLOAT, sumsquare_logical_io_reads) / count_executions - avg_logical_io_reads * avg_logical_io_reads, 2) AS sqdiff_logical_io_reads
										,round(convert(FLOAT, sumsquare_logical_io_writes) / count_executions - avg_logical_io_writes * avg_logical_io_writes, 2) AS sqdiff_logical_io_writes
										,round(convert(FLOAT, sumsquare_physical_io_reads) / count_executions - avg_physical_io_reads * avg_physical_io_reads, 2) AS sqdiff_physical_io_reads
										,round(convert(FLOAT, sumsquare_clr_time) / count_executions - avg_clr_time * avg_clr_time, 2) AS sqdiff_clr_time
										,round(convert(FLOAT, sumsquare_dop) / count_executions - avg_dop * avg_dop, 2) AS sqdiff_dop
										,round(convert(FLOAT, sumsquare_query_max_used_memory) / count_executions - avg_query_max_used_memory * avg_query_max_used_memory, 2) AS sqdiff_query_max_used_memory
										,round(convert(FLOAT, sumsquare_rowcount) / count_executions - avg_rowcount * avg_rowcount, 2) AS sqdiff_rowcount
										,round(convert(FLOAT, sumsquare_num_physical_io_reads) / count_executions - avg_num_physical_io_reads * avg_num_physical_io_reads, 2) AS sqdiff_num_physical_io_reads
										,round(convert(FLOAT, sumsquare_log_bytes_used) / count_executions - avg_log_bytes_used * avg_log_bytes_used, 2) AS sqdiff_log_bytes_used
										,round(convert(FLOAT, sumsquare_tempdb_space_used) / count_executions - avg_tempdb_space_used * avg_tempdb_space_used, 2) AS sqdiff_tempdb_space_used
										,round(convert(FLOAT, sumsquare_page_server_io_reads) / count_executions - avg_page_server_io_reads * avg_page_server_io_reads, 2) AS sqdiff_page_server_io_reads
									FROM (
										SELECT rs.*
											,CONVERT(FLOAT, total_duration) / count_executions AS avg_duration
											,CONVERT(FLOAT, total_cpu_time) / count_executions AS avg_cpu_time
											,CONVERT(FLOAT, total_logical_io_reads) / count_executions AS avg_logical_io_reads
											,CONVERT(FLOAT, total_logical_io_writes) / count_executions AS avg_logical_io_writes
											,CONVERT(FLOAT, total_physical_io_reads) / count_executions AS avg_physical_io_reads
											,CONVERT(FLOAT, total_clr_time) / count_executions AS avg_clr_time
											,CONVERT(FLOAT, total_dop) / count_executions AS avg_dop
											,CONVERT(FLOAT, total_query_max_used_memory) / count_executions AS avg_query_max_used_memory
											,CONVERT(FLOAT, total_rowcount) / count_executions AS avg_rowcount
											,CONVERT(FLOAT, total_num_physical_io_reads) / count_executions AS avg_num_physical_io_reads
											,CONVERT(FLOAT, total_log_bytes_used) / count_executions AS avg_log_bytes_used
											,CONVERT(FLOAT, total_tempdb_space_used) / count_executions AS avg_tempdb_space_used
											,CONVERT(FLOAT, total_page_server_io_reads) / count_executions AS avg_page_server_io_reads
										FROM sys.plan_persist_runtime_stats_merged rs
										) AS AVG_V
									) AS AVG_SQ_V
								LEFT JOIN sys.syspalvalues n ON n.class = 'QDXT'
									AND n.value = execution_type

								CREATE VIEW sys.query_store_runtime_stats_interval
								AS
								SELECT *
								FROM sys.plan_persist_runtime_stats_interval_merged

								CREATE VIEW sys.query_store_wait_stats
								AS
								SELECT wait_stats_id
									,plan_id
									,runtime_stats_interval_id
									,wait_category
									,c.name AS wait_category_desc
									,execution_type
									,n.name AS execution_type_desc
									,total_query_wait_time_ms
									,avg_query_wait_time_ms
									,last_query_wait_time_ms
									,min_query_wait_time_ms
									,max_query_wait_time_ms
									,CASE 
										WHEN sqdiff_query_wait_time_ms >= 0
											THEN sqrt(sqdiff_query_wait_time_ms)
										ELSE NULL
										END AS stdev_query_wait_time_ms
									,replica_group_id
								FROM (
									SELECT *
										,round(convert(FLOAT, sumsquare_query_wait_time_ms) / count_executions - avg_query_wait_time_ms * avg_query_wait_time_ms, 2) AS sqdiff_query_wait_time_ms
									FROM (
										SELECT ws.*
											,CONVERT(FLOAT, total_query_wait_time_ms) / count_executions AS avg_query_wait_time_ms
										FROM sys.plan_persist_wait_stats_merged ws
										) AS AVG_VAL
									) AS AVG_SQ_VAL
								LEFT JOIN sys.syspalvalues c ON c.class = 'WCAT'
									AND c.value = wait_category
								LEFT JOIN sys.syspalvalues n ON n.class = 'QDXT'
									AND n.value = execution_type
					)
	)

