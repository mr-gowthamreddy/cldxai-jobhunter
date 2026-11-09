// Rule-based guidance: resume improvement suggestions, missing-skills analysis
// and interview preparation. Deterministic and local — no data leaves the server.

import { skillGroup } from './taxonomy.mjs';

/** Suggestions to improve a resume, from its parsed data and raw text. */
export function resumeSuggestions(data, rawText = '', { marketMissing = [] } = {}) {
  const out = [];
  const text = rawText || '';
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!data.email) out.push({ level: 'high', title: 'Add an email address', detail: 'Recruiters and ATS systems need a contact email near the top of the resume.' });
  if (!data.phone) out.push({ level: 'medium', title: 'Add a phone number', detail: 'A reachable phone number is expected by most recruiters, especially for fast-moving roles.' });
  if (!/linkedin\.com/i.test(text)) out.push({ level: 'low', title: 'Link your LinkedIn profile', detail: 'A LinkedIn URL lets reviewers confirm your history quickly.' });
  if (!data.summary) out.push({ level: 'medium', title: 'Add a short professional summary', detail: 'Two or three lines naming your role, years of experience and core stack help both humans and keyword filters.' });
  const bullets = text.split('\n').filter((l) => /^\s*[•\-*▪●◦]/.test(l));
  const quantified = bullets.filter((l) => /\d/.test(l));
  if (bullets.length >= 3 && quantified.length / bullets.length < 0.3) {
    out.push({ level: 'high', title: 'Quantify your achievements', detail: `Only ${quantified.length} of ${bullets.length} bullet points contain a number. Add scale, impact or time saved (e.g. "cut pipeline runtime by 40%").` });
  }
  const weakVerbs = (text.match(/\b(responsible for|worked on|helped with|involved in|duties included)\b/gi) || []).length;
  if (weakVerbs >= 2) out.push({ level: 'medium', title: 'Use stronger action verbs', detail: `Found ${weakVerbs} passive phrases like "responsible for". Start bullets with verbs such as built, led, designed, reduced or automated.` });
  if (words > 1400) out.push({ level: 'medium', title: 'Tighten the resume', detail: `It is about ${words} words. Two pages (~800–1000 words) is usually enough; trim older or less relevant roles.` });
  if (words && words < 200) out.push({ level: 'medium', title: 'Add more detail', detail: 'The resume is very short. Describe your responsibilities and results for each role.' });
  const skillCount = (data.technical_skills || []).length + (data.programming_languages || []).length + (data.cloud_platforms || []).length + (data.databases || []).length;
  if (skillCount < 5) out.push({ level: 'high', title: 'Add a clear skills section', detail: 'Few recognisable skills were found. A "Skills" section listing tools and technologies improves both matching and ATS parsing.' });
  if (!(data.certifications || []).length && skillCount >= 5) out.push({ level: 'low', title: 'Consider a certification', detail: 'A relevant certification (cloud, data platform or domain) can help when you are near the experience bar.' });
  if (!(data.education || []).length) out.push({ level: 'low', title: 'Add your education', detail: 'List your highest degree or relevant training, even if brief.' });
  if (marketMissing.length) {
    out.push({ level: 'medium', title: 'Skills in demand for your matches', detail: `Jobs that match you often ask for ${marketMissing.slice(0, 6).map((m) => m.skill).join(', ')}. If you have used them, mention them explicitly; if not, they are good learning targets.` });
  }
  if (!out.length) out.push({ level: 'info', title: 'Looks solid', detail: 'No structural issues found. Tailor the summary and top bullets to each job you apply for.' });
  return out;
}

/** Aggregate missing skills across a set of match results. */
export function missingSkillsAnalysis(matches, limit = 15) {
  const counts = new Map();
  for (const m of matches) for (const s of m.missing_skills || []) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([skill, count]) => ({ skill, count, share: matches.length ? Math.round((count / matches.length) * 100) : 0, group: skillGroup(skill) }));
}

const TOPICS = {
  SQL: ['Window functions (ROW_NUMBER, LAG/LEAD, running totals)', 'Joins vs. subqueries vs. CTEs and their performance', 'Query plans, indexes and partition pruning'],
  'Apache Spark': ['Narrow vs. wide transformations and shuffles', 'Partitioning, skew handling and broadcast joins', 'Caching/persistence and the Catalyst optimizer'],
  PySpark: ['DataFrame API vs. Spark SQL', 'UDFs vs. built-in functions (and why to avoid Python UDFs)', 'Reading/writing Delta or Parquet efficiently'],
  Databricks: ['Delta Lake ACID, time travel, OPTIMIZE/Z-ORDER', 'Medallion (bronze/silver/gold) architecture', 'Jobs, clusters and Unity Catalog governance'],
  Snowflake: ['Virtual warehouses, scaling and cost control', 'Micro-partitions, clustering and query pruning', 'Streams, tasks, Snowpipe and zero-copy cloning'],
  dbt: ['Models, sources, refs and the DAG', 'Incremental models and snapshots', 'Tests, documentation and CI for dbt projects'],
  'Azure Data Factory': ['Pipelines, activities, linked services and integration runtimes', 'Parameterisation and metadata-driven pipelines', 'Monitoring, retries and failure alerts'],
  'Microsoft Fabric': ['OneLake, lakehouses and warehouses in Fabric', 'Data pipelines and Dataflows Gen2', 'Direct Lake mode for Power BI'],
  'Power BI': ['Star-schema data modelling', 'DAX: CALCULATE, filter context and time intelligence', 'Row-level security and refresh strategies'],
  Python: ['Data structures and complexity', 'Generators, decorators and context managers', 'Testing with pytest and packaging'],
  AWS: ['Core services (IAM, S3, EC2, Lambda, VPC)', 'Designing for cost and high availability', 'Security best practices and least privilege'],
  Azure: ['Resource groups, RBAC and managed identities', 'Storage accounts and networking basics', 'Azure Monitor and cost management'],
  GCP: ['IAM, projects and service accounts', 'BigQuery, GCS and Pub/Sub', 'GKE and Cloud Run basics'],
  Kubernetes: ['Pods, deployments, services and ingress', 'Resource requests/limits and autoscaling', 'Debugging failing pods'],
  Docker: ['Image layers and multi-stage builds', 'Networking and volumes', 'Container security basics'],
  Terraform: ['State, backends and locking', 'Modules and environments', 'Plan/apply in CI'],
  React: ['Hooks and rendering behaviour', 'State management and data fetching', 'Performance (memoisation, code splitting)'],
  Java: ['Collections and concurrency', 'JVM memory and garbage collection', 'Spring Boot fundamentals'],
  'Machine Learning': ['Bias/variance and regularisation', 'Evaluation metrics and validation strategy', 'Feature engineering and leakage'],
  Kafka: ['Topics, partitions and consumer groups', 'Delivery semantics (at-least-once, exactly-once)', 'Schema evolution'],
  'Apache Airflow': ['DAGs, operators and sensors', 'Idempotent tasks and backfills', 'XComs and task dependencies'],
  SEO: ['Technical SEO audits', 'Keyword research and content strategy', 'Measuring organic performance'],
  'Product Management': ['Prioritisation frameworks (RICE, Kano)', 'Writing a PRD and success metrics', 'Stakeholder alignment stories'],
  Excel: ['Pivot tables and lookups (XLOOKUP/INDEX-MATCH)', 'Data cleaning and validation', 'Charts and dashboards'],
};

const STAGE_TIPS = {
  Applied: ['Research the company: product, customers, recent news and engineering blog.', 'Prepare a 60-second introduction tailored to this role.'],
  'Interview Scheduled': ['Confirm the format, duration and interviewers.', 'Prepare 4–5 STAR stories that cover impact, conflict, failure and leadership.'],
  'Technical Round': ['Practise explaining your past system designs end to end.', 'Do timed practice on the core skills listed below.', 'Think aloud and state trade-offs during problem solving.'],
  'HR Round': ['Know your notice period, expected compensation and joining date.', 'Prepare answers on why this company and why you are moving.'],
  'Offer Received': ['Compare total compensation, not just base salary.', 'Ask for the offer in writing and clarify benefits, notice period and probation.'],
};

/** Interview-prep plan for a job (required skills) and an application stage. */
export function interviewPrep({ title = '', company = '', requiredSkills = [], missingSkills = [], status = 'Applied' } = {}) {
  const focus = [];
  for (const s of requiredSkills) if (TOPICS[s]) focus.push({ skill: s, topics: TOPICS[s], gap: missingSkills.includes(s) });
  for (const s of requiredSkills) if (!TOPICS[s] && focus.length < 8) focus.push({ skill: s, topics: [`Be ready to describe a project where you used ${s}, and what you would do differently.`], gap: missingSkills.includes(s) });
  focus.sort((a, b) => Number(b.gap) - Number(a.gap));
  return {
    headline: `Preparation plan for ${title}${company ? ` at ${company}` : ''}`,
    stage_tips: STAGE_TIPS[status] || STAGE_TIPS.Applied,
    skill_focus: focus.slice(0, 8),
    gaps: missingSkills.slice(0, 6).map((s) => `Be honest about ${s}: explain a related tool you know and how you would ramp up.`),
    behavioural: [
      'Tell me about a project you are proud of and your exact contribution.',
      'Describe a production incident or failure and what you changed afterwards.',
      'How do you handle disagreement with a stakeholder or teammate?',
      'Why this role and this company?',
    ],
    questions_to_ask: [
      'What does success look like in the first 90 days?',
      'How is the team structured, and who would I work with most?',
      'What are the biggest challenges the team faces right now?',
    ],
  };
}
