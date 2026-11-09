// Skill vocabulary + job categories for the platform.
//
// Skills are grouped so a resume can be split into "programming languages",
// "cloud platforms", "databases" etc. Each entry is [CanonicalName, ...aliases];
// aliases are matched case-insensitively on word boundaries. The list spans
// many professions on purpose: the platform must not assume every user is a
// data engineer. career-ops' own flat vocabulary (skill-extract.mjs) is merged
// in at extraction time to widen coverage.

export const SKILL_GROUPS = {
  programming_languages: [
    ['Python'], ['Java'], ['JavaScript', 'JS', 'ECMAScript'], ['TypeScript', 'TS'], ['C++', 'CPP'], ['C#', 'CSharp'],
    ['Go', 'Golang'], ['Rust'], ['Ruby'], ['PHP'], ['Kotlin'], ['Swift'], ['Scala'], ['R'], ['MATLAB'],
    ['Perl'], ['Bash', 'Shell Scripting', 'Shell'], ['PowerShell'], ['SQL'], ['T-SQL', 'TSQL'], ['PL/SQL', 'PLSQL'],
    ['Dart'], ['Elixir'], ['Haskell'], ['Objective-C'], ['VBA'], ['SAS'], ['Julia'], ['Solidity'], ['C'],
  ],
  cloud_platforms: [
    ['AWS', 'Amazon Web Services'], ['Azure', 'Microsoft Azure'], ['GCP', 'Google Cloud', 'Google Cloud Platform'],
    ['Oracle Cloud', 'OCI'], ['IBM Cloud'], ['Alibaba Cloud'], ['Heroku'], ['Vercel'], ['DigitalOcean'], ['Cloudflare'],
  ],
  databases: [
    ['PostgreSQL', 'Postgres'], ['MySQL'], ['SQL Server', 'MSSQL', 'Microsoft SQL Server'], ['Oracle Database', 'Oracle DB'],
    ['MongoDB'], ['Redis'], ['Cassandra'], ['DynamoDB'], ['Snowflake'], ['BigQuery'], ['Redshift', 'Amazon Redshift'],
    ['Azure Synapse', 'Synapse Analytics', 'Synapse'], ['Cosmos DB', 'CosmosDB'], ['Elasticsearch', 'OpenSearch'],
    ['SQLite'], ['MariaDB'], ['Neo4j'], ['ClickHouse'], ['Teradata'], ['DB2'], ['Firestore', 'Firebase'], ['Delta Lake'],
    ['Apache Iceberg', 'Iceberg'], ['Pinecone'], ['Supabase'], ['HBase'], ['Hive'],
  ],
  data_engineering: [
    ['Databricks'], ['Apache Spark', 'Spark'], ['PySpark'], ['Spark SQL'], ['dbt', 'data build tool'], ['Apache Airflow', 'Airflow'],
    ['Azure Data Factory', 'ADF'], ['Microsoft Fabric', 'MS Fabric', 'Fabric'], ['Kafka', 'Apache Kafka'], ['Flink', 'Apache Flink'],
    ['Hadoop'], ['ETL'], ['ELT'], ['Data Warehousing', 'Data Warehouse'], ['Data Modeling', 'Data Modelling', 'Dimensional Modeling'],
    ['Data Lake', 'Data Lakehouse', 'Lakehouse'], ['Fivetran'], ['Airbyte'], ['Informatica'], ['Talend'], ['SSIS'], ['Azure Data Lake', 'ADLS'],
    ['AWS Glue', 'Glue'], ['Kinesis'], ['Dagster'], ['Prefect'], ['Unity Catalog'], ['Data Pipelines', 'Data Pipeline'], ['Data Governance'],
    ['Data Quality'], ['Streaming', 'Stream Processing'], ['Event Hubs', 'Azure Event Hubs'], ['Stream Analytics'], ['Matillion'],
  ],
  analytics_bi: [
    ['Power BI', 'PowerBI'], ['Tableau'], ['Looker'], ['Qlik', 'QlikView', 'Qlik Sense'], ['Excel', 'Microsoft Excel', 'Advanced Excel'],
    ['DAX'], ['Power Query'], ['SSRS'], ['SSAS'], ['Google Analytics', 'GA4'], ['Metabase'], ['Superset', 'Apache Superset'],
    ['Data Analysis', 'Data Analytics'], ['Data Visualization', 'Data Visualisation'], ['Statistics', 'Statistical Analysis'], ['A/B Testing'],
    ['Mixpanel'], ['Amplitude'], ['Alteryx'],
  ],
  ml_ai: [
    ['Machine Learning', 'ML'], ['Deep Learning'], ['TensorFlow'], ['PyTorch'], ['scikit-learn', 'sklearn'], ['Pandas'], ['NumPy'],
    ['NLP', 'Natural Language Processing'], ['Computer Vision'], ['LLM', 'LLMs', 'Large Language Models'], ['Generative AI', 'GenAI'],
    ['RAG', 'Retrieval-Augmented Generation'], ['LangChain'], ['Hugging Face', 'HuggingFace'], ['MLOps'], ['MLflow'], ['Keras'],
    ['XGBoost'], ['Prompt Engineering'], ['OpenAI API'], ['Azure Machine Learning', 'Azure ML'], ['SageMaker', 'AWS SageMaker'], ['Vertex AI'],
  ],
  devops_infra: [
    ['Docker'], ['Kubernetes', 'k8s'], ['Terraform'], ['Ansible'], ['Jenkins'], ['GitHub Actions'], ['GitLab CI'], ['Azure DevOps'],
    ['CI/CD', 'CICD', 'Continuous Integration'], ['Helm'], ['Prometheus'], ['Grafana'], ['Datadog'], ['Linux'], ['Git'], ['Nginx'],
    ['CloudFormation'], ['Bicep', 'ARM Templates'], ['Serverless'], ['AWS Lambda', 'Lambda'], ['Azure Functions'], ['EC2'], ['S3', 'Amazon S3'],
    ['Networking', 'TCP/IP'], ['Microservices'], ['Site Reliability', 'SRE'], ['Observability'], ['Splunk'], ['ELK'],
  ],
  frameworks_web: [
    ['React', 'React.js', 'ReactJS'], ['Angular'], ['Vue', 'Vue.js', 'VueJS'], ['Next.js', 'NextJS'], ['Node.js', 'NodeJS', 'Node'],
    ['Express', 'Express.js'], ['Django'], ['Flask'], ['FastAPI'], ['Spring Boot', 'Spring'], ['.NET', 'ASP.NET', 'dotnet', '.NET Core'],
    ['Ruby on Rails', 'Rails'], ['Laravel'], ['GraphQL'], ['REST APIs', 'REST', 'RESTful', 'REST API'], ['HTML', 'HTML5'], ['CSS', 'CSS3'],
    ['Tailwind', 'Tailwind CSS'], ['Redux'], ['React Native'], ['Flutter'], ['Android'], ['iOS'], ['gRPC'], ['RabbitMQ'], ['Svelte'],
  ],
  testing_qa: [
    ['Selenium'], ['Cypress'], ['Playwright'], ['Jest'], ['pytest', 'PyTest'], ['JUnit'], ['TestNG'], ['Postman'], ['Appium'],
    ['Manual Testing'], ['Automation Testing', 'Test Automation'], ['Performance Testing', 'JMeter'], ['API Testing'], ['TDD'], ['BDD', 'Cucumber'],
  ],
  security: [
    ['Cybersecurity', 'Information Security', 'InfoSec'], ['IAM', 'Identity and Access Management'], ['SIEM'], ['Penetration Testing', 'Pentesting'],
    ['OWASP'], ['SOC 2', 'SOC2'], ['ISO 27001'], ['Vulnerability Management'], ['Network Security'], ['Zero Trust'], ['Azure AD', 'Entra ID'],
  ],
  business_product: [
    ['Product Management'], ['Agile'], ['Scrum'], ['Kanban'], ['JIRA', 'Jira'], ['Confluence'], ['Stakeholder Management'],
    ['Project Management'], ['Roadmapping', 'Product Roadmap'], ['User Research'], ['Business Analysis'], ['Requirements Gathering'],
    ['SAP'], ['Salesforce'], ['ServiceNow'], ['Workday'], ['ERP'], ['CRM'], ['HubSpot'], ['Zendesk'],
  ],
  design: [
    ['Figma'], ['Sketch'], ['Adobe XD'], ['Photoshop', 'Adobe Photoshop'], ['Illustrator', 'Adobe Illustrator'], ['UI Design'], ['UX Design'],
    ['Wireframing'], ['Prototyping'], ['Design Systems'], ['InDesign'], ['After Effects'], ['Canva'],
  ],
  marketing_sales: [
    ['SEO'], ['SEM'], ['Content Marketing'], ['Social Media Marketing', 'Social Media'], ['Email Marketing'], ['Google Ads'], ['Meta Ads', 'Facebook Ads'],
    ['Copywriting'], ['Marketing Automation'], ['Lead Generation'], ['B2B Sales'], ['Account Management'], ['Business Development'],
    ['Negotiation'], ['Cold Calling'], ['Customer Success'], ['Brand Management'], ['Market Research'], ['Growth Marketing'],
  ],
  finance_ops: [
    ['Accounting'], ['Financial Modeling', 'Financial Modelling'], ['Financial Analysis'], ['FP&A'], ['Budgeting'], ['Forecasting'],
    ['Tally'], ['QuickBooks'], ['GST'], ['Taxation'], ['Audit', 'Internal Audit'], ['Bookkeeping'], ['IFRS'], ['GAAP'], ['Payroll'],
    ['Supply Chain'], ['Procurement'], ['Logistics'], ['Operations Management'], ['Risk Management'], ['Compliance'],
  ],
  people_hr: [
    ['Recruitment', 'Recruiting', 'Talent Acquisition'], ['HRIS'], ['Employee Relations'], ['Onboarding'], ['Performance Management'],
    ['Compensation and Benefits', 'C&B'], ['Learning and Development', 'L&D'],
  ],
  healthcare_other: [
    ['Patient Care'], ['Clinical Research'], ['EMR', 'EHR'], ['Nursing'], ['Pharmacovigilance'], ['Teaching'], ['Customer Service'],
    ['Technical Writing'], ['AutoCAD'], ['SolidWorks'], ['Embedded Systems'], ['PLC'],
  ],
};

export const RESUME_GROUP_MAP = {
  programming_languages: 'programming_languages',
  cloud_platforms: 'cloud_platforms',
  databases: 'databases',
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Some aliases are ordinary English words; they only count with stricter rules.
const AMBIGUOUS = new Set(['go', 'r', 'c', 'node', 'shell', 'spark', 'glue', 'fabric', 'synapse', 'streaming', 'excel', 'lambda', 'spring', 'ml', 'ts', 'js', 'audit', 'iceberg', 'express', 'helm', 'swift', 'rails', 'teaching', 'nursing', 'linux', 'git', 'statistics', 'hive', 's3', 'elk', 'iam']);
// Ambiguous aliases accepted only in a recognisable technical form.
const STRICT_FORMS = {
  go: /(?<![A-Za-z0-9])(?:Go(?:lang)?)(?=\s*(?:,|\/|\)|\(|;|\.\s|\s+(?:and|or|developer|engineer|programming|language|services|microservices|backend|lang)\b|$))/,
  r: /(?<![A-Za-z0-9])R(?=\s*(?:,|\/|\)|;|\s+(?:programming|language|studio|shiny)\b))|(?<=(?:Python|SAS|SQL|Stata|MATLAB)\s*(?:,|\/|and|or)\s*)R(?![A-Za-z0-9])/,
  c: /(?<![A-Za-z0-9+#])C(?![A-Za-z0-9+#])(?=\s*(?:,|\/|\)|;|\s+(?:programming|language)\b))|(?<=(?:C\+\+|Python|Java|Assembly)\s*(?:,|\/|and|or)\s*)C(?![A-Za-z0-9+#])/,
  node: /\bNode(?:\.js|JS)?\b(?=\s*(?:,|\/|\)|;|\s+(?:backend|server|developer|engineer)\b))/,
  ts: /\bTS\b(?=\s*(?:,|\/|\)))/,
  js: /\bJS\b(?=\s*(?:,|\/|\)))/,
  ml: /\bML\b/,
};
const CASE_SENSITIVE = new Set(['SAS', 'SAP', 'ERP', 'CRM', 'SEO', 'SEM', 'IAM', 'GST', 'PLC', 'ADF', 'ELK', 'EC2', 'S3', 'ML', 'R', 'C', 'TS', 'JS', 'Go', 'SRE', 'TDD', 'BDD', 'ETL', 'ELT', 'RAG', 'NLP', 'LLM', 'LLMs', 'SIEM', 'DAX', 'OCI', 'ADLS', 'SSIS', 'SSRS', 'SSAS', 'EMR', 'EHR', 'HRIS', 'GA4', 'FP&A']);

function buildMatcher(alias) {
  const lower = alias.toLowerCase();
  if (STRICT_FORMS[lower]) return STRICT_FORMS[lower];
  const flags = CASE_SENSITIVE.has(alias) ? '' : 'i';
  // Word boundaries that also work for C++, C#, .NET, CI/CD.
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(alias)}(?![A-Za-z0-9+#])`, flags);
}

export const SKILLS = [];
for (const [group, entries] of Object.entries(SKILL_GROUPS)) {
  for (const [canonical, ...aliases] of entries) {
    const forms = [canonical, ...aliases];
    SKILLS.push({
      name: canonical,
      group,
      matchers: forms.map((f) => ({ form: f, re: buildMatcher(f), ambiguous: AMBIGUOUS.has(f.toLowerCase()) })),
    });
  }
}

const CANONICAL_BY_LOWER = new Map();
for (const s of SKILLS) {
  CANONICAL_BY_LOWER.set(s.name.toLowerCase(), s);
  for (const m of s.matchers) CANONICAL_BY_LOWER.set(m.form.toLowerCase(), s);
}

/** Canonical display name for any alias the taxonomy knows, else the trimmed input. */
export function canonicalSkill(name) {
  const s = CANONICAL_BY_LOWER.get(String(name || '').trim().toLowerCase());
  return s ? s.name : String(name || '').trim();
}

export function skillGroup(name) {
  return CANONICAL_BY_LOWER.get(String(name || '').trim().toLowerCase())?.group || 'other';
}

/**
 * Find taxonomy skills mentioned in text. Returns canonical names, de-duplicated,
 * in taxonomy order. Ambiguous aliases (Go, R, Spark...) count only in their
 * strict technical form, or when an unambiguous sibling alias is also present.
 */
export function findSkills(text) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const found = [];
  for (const skill of SKILLS) {
    let hit = false;
    for (const m of skill.matchers) {
      if (m.ambiguous && !STRICT_FORMS[m.form.toLowerCase()]) {
        // e.g. "Spark": accept "Apache Spark" or "Spark" next to a data word.
        if (m.re.test(t) && contextHit(t, m.form)) { hit = true; break; }
        continue;
      }
      if (m.re.test(t)) { hit = true; break; }
    }
    if (hit) found.push(skill.name);
  }
  // Spark SQL / PySpark imply Spark; Databricks often implies Spark too but we don't infer.
  if ((found.includes('PySpark') || found.includes('Spark SQL')) && !found.includes('Apache Spark')) found.push('Apache Spark');
  return found;
}

const TECH_CONTEXT = /\b(sql|python|data|cloud|aws|azure|gcp|pipeline|engineer|developer|scala|java|etl|kubernetes|docker|framework|platform|api|database|devops|stack|tools?|technologies|skills?|experience with|proficien|hands-on|knowledge of)\b/i;
function contextHit(text, form) {
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(form)}(?![A-Za-z0-9])`, 'gi');
  for (const m of text.matchAll(re)) {
    const window = text.slice(Math.max(0, m.index - 80), m.index + form.length + 80);
    // A comma-separated list of other known skills is the strongest signal.
    if (TECH_CONTEXT.test(window) || /,\s*\w+\s*,/.test(window)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Job categories. Specialised data/cloud categories are first-class, the rest
// cover the general market. A job can sit in several categories.
// Each category: skills that put a job in it, and title patterns.

export const CATEGORIES = [
  { slug: 'snowflake', name: 'Snowflake', featured: true, skills: ['Snowflake'], title: /\bsnowflake\b/i },
  { slug: 'azure-data-engineering', name: 'Azure Data Engineering', featured: true, skills: ['Azure Data Factory', 'Azure Synapse', 'Azure Data Lake', 'Microsoft Fabric', 'Event Hubs', 'Stream Analytics'], requireAny: ['Azure'], title: /\bazure\b.*\bdata\b|\bdata\b.*\bazure\b/i },
  { slug: 'databricks', name: 'Databricks', featured: true, skills: ['Databricks', 'Unity Catalog', 'Delta Lake'], title: /\bdatabricks\b/i },
  { slug: 'pyspark', name: 'PySpark', featured: true, skills: ['PySpark', 'Apache Spark', 'Spark SQL'], title: /\b(py)?spark\b/i },
  { slug: 'sql', name: 'SQL', featured: true, skills: ['SQL', 'T-SQL', 'PL/SQL', 'Spark SQL'], title: /\bsql\b/i, minSkillHits: 1 },
  { slug: 'dbt', name: 'dbt', featured: true, skills: ['dbt'], title: /\bdbt\b/i },
  { slug: 'microsoft-fabric', name: 'Microsoft Fabric', featured: true, skills: ['Microsoft Fabric'], title: /\bfabric\b/i },
  { slug: 'power-bi', name: 'Power BI', featured: true, skills: ['Power BI', 'DAX', 'Power Query'], title: /\bpower\s?bi\b/i },
  { slug: 'data-engineering', name: 'Data Engineering', featured: true, skills: ['ETL', 'ELT', 'Data Pipelines', 'Apache Airflow', 'Data Warehousing', 'Data Lake', 'Kafka', 'dbt', 'Databricks', 'PySpark', 'Azure Data Factory'], minSkillHits: 2, title: /\bdata\s+(engineer|engineering|platform|architect|infrastructure|ops)\b|\betl\b|\banalytics engineer/i },
  { slug: 'cloud-engineering', name: 'Cloud Engineering', featured: true, skills: ['AWS', 'Azure', 'GCP', 'Terraform', 'Kubernetes', 'CloudFormation', 'Serverless'], minSkillHits: 2, title: /\bcloud\b|\bplatform engineer|\binfrastructure engineer/i },
  { slug: 'data-science-ml', name: 'Data Science & ML', skills: ['Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'scikit-learn', 'NLP', 'Computer Vision', 'LLM', 'MLOps'], minSkillHits: 2, title: /\b(data scien|machine learning|ml engineer|\bai\b|research scientist|applied scientist|nlp|computer vision|llm)/i },
  { slug: 'data-analytics', name: 'Data & Business Analytics', skills: ['Power BI', 'Tableau', 'Looker', 'Data Analysis', 'Excel', 'Statistics'], minSkillHits: 2, title: /\b(data|business|bi|reporting|insights?|product)\s+analyst|\banalytics\b/i },
  { slug: 'software-engineering', name: 'Software Engineering', skills: [], title: /\b(software|backend|back-end|full[\s-]?stack|application|java|python|golang|\.net|node)\s*(engineer|developer|programmer)|\bsde\b|\bswe\b|\bdeveloper\b/i },
  { slug: 'frontend', name: 'Frontend & Mobile', skills: ['React', 'Angular', 'Vue', 'Next.js', 'React Native', 'Flutter', 'iOS', 'Android'], minSkillHits: 2, title: /\b(front[\s-]?end|ui engineer|web developer|ios|android|mobile)\b/i },
  { slug: 'devops-sre', name: 'DevOps & SRE', skills: ['Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'Jenkins', 'Site Reliability', 'Observability'], minSkillHits: 3, title: /\b(devops|sre|site reliability|reliability engineer|release engineer|build engineer)\b/i },
  { slug: 'qa-testing', name: 'QA & Testing', skills: ['Selenium', 'Cypress', 'Automation Testing', 'Manual Testing', 'Appium'], minSkillHits: 2, title: /\b(qa|quality assurance|test|sdet|tester)\b/i },
  { slug: 'security', name: 'Security', skills: ['Cybersecurity', 'SIEM', 'Penetration Testing', 'Vulnerability Management'], minSkillHits: 2, title: /\b(security|secops|appsec|soc analyst|cyber)\b/i },
  { slug: 'product', name: 'Product Management', skills: [], title: /\bproduct (manager|owner|lead|director)|\bhead of product|\bpm\b/i },
  { slug: 'design', name: 'Design & UX', skills: ['Figma', 'UI Design', 'UX Design', 'Prototyping'], minSkillHits: 2, title: /\b(designer|ux|ui\/ux|design lead|user research)/i },
  { slug: 'marketing', name: 'Marketing', skills: ['SEO', 'SEM', 'Content Marketing', 'Growth Marketing', 'Google Ads'], minSkillHits: 2, title: /\bmarketing|\bseo\b|\bgrowth\b|\bcontent (writer|strategist)|\bbrand\b/i },
  { slug: 'sales', name: 'Sales & Business Development', skills: ['B2B Sales', 'Business Development', 'Lead Generation'], minSkillHits: 2, title: /\b(sales|account executive|business development|bdr|sdr|account manager|partnerships)\b/i },
  { slug: 'customer-success', name: 'Customer Success & Support', skills: ['Customer Success', 'Customer Service', 'Zendesk'], minSkillHits: 2, title: /\b(customer (success|support|service|experience)|support (engineer|specialist)|technical support|implementation)/i },
  { slug: 'finance', name: 'Finance & Accounting', skills: ['Accounting', 'FP&A', 'Financial Analysis', 'Taxation', 'Audit'], minSkillHits: 2, title: /\b(finance|financial|accountant|accounting|fp&a|controller|tax|audit|treasury|payroll)\b/i },
  { slug: 'hr-recruiting', name: 'HR & Recruiting', skills: ['Recruitment', 'HRIS', 'Employee Relations'], minSkillHits: 2, title: /\b(recruiter|talent|hr\b|human resources|people (partner|operations)|hrbp)/i },
  { slug: 'operations', name: 'Operations & Supply Chain', skills: ['Supply Chain', 'Logistics', 'Procurement', 'Operations Management'], minSkillHits: 2, title: /\b(operations|supply chain|logistics|procurement|program manager|project manager)\b/i },
  { slug: 'legal-compliance', name: 'Legal & Compliance', skills: ['Compliance', 'Risk Management'], minSkillHits: 2, title: /\b(legal|counsel|lawyer|paralegal|compliance|risk)\b/i },
  { slug: 'healthcare', name: 'Healthcare', skills: ['Patient Care', 'Clinical Research', 'Nursing', 'EMR'], minSkillHits: 1, title: /\b(nurse|clinical|physician|medical|healthcare|pharmac|therapist)\b/i },
  { slug: 'other', name: 'Other', skills: [], title: null },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

/** Categorize a job from its title + extracted skills. Always returns >= 1 slug. */
export function categorize(title, skills) {
  const skillSet = new Set(skills);
  const out = [];
  for (const cat of CATEGORIES) {
    if (cat.slug === 'other') continue;
    const titleHit = cat.title ? cat.title.test(title || '') : false;
    const hits = cat.skills.filter((s) => skillSet.has(s)).length;
    const need = cat.minSkillHits ?? 1;
    let skillHit = cat.skills.length > 0 && hits >= need;
    if (skillHit && cat.requireAny) skillHit = cat.requireAny.some((s) => skillSet.has(s));
    // "SQL" appears in most technical JDs; only count it as a category when the
    // title says SQL or the job is clearly data-centric.
    if (cat.slug === 'sql' && !titleHit) skillHit = skillHit && /\b(data|analyst|database|bi|sql|etl|analytics)\b/i.test(title || '');
    if (cat.slug === 'microsoft-fabric' && titleHit && !skillSet.has('Microsoft Fabric') && !/microsoft fabric|ms fabric/i.test(title)) continue;
    if (titleHit || skillHit) out.push(cat.slug);
  }
  if (out.length === 0) out.push('other');
  return out;
}
