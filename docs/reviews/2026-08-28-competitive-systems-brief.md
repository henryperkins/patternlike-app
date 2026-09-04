# Competitive systems audit: The Pattern, Co–Star, and Astro.com

**Research date:** August 28, 2026

## Executive finding

These products should not be treated as three implementations of the same “AI astrology” system.

* **The Pattern** has an established chart-to-authored-content product and, since late 2025, a separate open-ended conversational feature called **In-Depth**. The company says In-Depth runs on its own hardware using a privately hosted model, does not use ChatGPT or another third-party AI, is based on thousands of human-created insights and audio recordings, and is not trained on users’ chats. It does **not** disclose the model, model lineage, system prompt, retrieval architecture, training corpus, context construction, safety classifiers, or evaluation results.
* **Co–Star** discloses the clearest modern generative architecture: NASA JPL astronomical data, a proprietary interpretation corpus, rules-based natural-language generation, AI models “like GPT,” staff poets, question parsing, and behavior-based ranking. It still does not disclose its model provider, exact prompts, fine-tuning or retrieval method, output-safety architecture, or evaluation metrics.
* **Astro.com/Astrodienst** primarily represents an older, deterministic AI tradition: Swiss Ephemeris calculations, a heavily sourced geographic and historical time-zone atlas, and a Prolog-based expert system that synthesizes human-authored astrological interpretations. Its “AI” is knowledge engineering rather than a contemporary LLM chat system. No first-party evidence surfaced that its core Astro*Intelligence reports currently use a modern generative model.

No company publishes enough information to reproduce its complete interpretation pipeline. **No exact system prompt, production context schema, model version history, safety test suite, or independently audited hallucination rate is public for either The Pattern or Co–Star.** Claims purporting to reveal those exact internals would be speculation.

## At-a-glance comparison

| Dimension                         | The Pattern                                                                                            | Co–Star                                                                            | Astro.com                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Core architecture                 | Chart-based readings plus a self-hosted conversational model                                           | Chart calculation, rules/NLG, GPT-like generation, human writers, behavior ranking | Swiss Ephemeris plus a Prolog expert system and authored text modules       |
| Astronomical source               | **Not publicly disclosed** in the materials reviewed                                                   | NASA Jet Propulsion Laboratory                                                     | JPL data through Swiss Ephemeris                                            |
| House framework                   | Whole House                                                                                            | Porphyry; tropical zodiac                                                          | User-configurable across its chart tools                                    |
| Interpretation source             | “Thousands” of human-created insights and audio recordings                                             | Five-year proprietary database built by poets, astrologers, and technologists      | Named astrologers including Liz Greene, Robert Hand, and Mona Riegger       |
| Modern generative AI              | Yes, In-Depth                                                                                          | Yes                                                                                | No modern LLM publicly identified for core reports                          |
| Personalization beyond chart      | Relationships, chat history, profile information, possibly usage context                               | Friends, questions, current transits, and past in-app behavior                     | Saved charts, selected report type, transits, relationships, chart settings |
| Publicly documented AI guardrails | Disclaimers; anti-jailbreak contractual restrictions; no routine human review; no emergency escalation | Unsafe/harmful-question blocking and crisis refusal/resource routing               | Finite structured inputs and deterministic synthesis rather than open chat  |
| Exact prompt/model disclosed      | No                                                                                                     | No                                                                                 | LLM prompt not applicable; exact Prolog knowledge base is not public        |
| Public evaluation evidence        | None found                                                                                             | None found                                                                         | No formal safety or interpretation-validity evaluation found                |

The astronomical calculations and interpretive claims must be separated. NASA JPL and Swiss Ephemeris can establish where celestial bodies were located. They do not establish that the personality, compatibility, or forecasting conclusions layered over those positions are empirically valid.

---

# 1. The Pattern

## 1.1 Probable system architecture

The evidence supports two related but distinct systems.

### Traditional Pattern readings

The longstanding product creates:

* natal-chart personality readings;
* temporary “Transits”;
* relationship “Bonds”;
* romantic transits;
* past and future “Time Travel” readings;
* shared experiences and other social content.

The Pattern says these are based on birth-chart information and uses the **Whole House** system. Its public materials describe decades of astrological research and a large collection of human-created readings, but do not identify its ephemeris, geocoding service, historical time-zone source, chart-calculation library, or rule-selection implementation.

The most defensible reconstruction is:

```text
birth date, time, and place
        ↓
undisclosed chart-calculation service
        ↓
natal positions, houses, aspects, transits, relationship factors
        ↓
rules or selection logic
        ↓
human-authored Pattern insights and audio
```

The final two stages are a **high-confidence inference**, not a disclosed implementation. A finite authored corpus and repeatable chart features strongly suggest some form of keyed selection, rules, or content assembly, but The Pattern has not published the rule system.

### In-Depth AI

The newer flow is probably closer to:

```text
user and subject chart data
        +
relationship/transit context
        +
selected Pattern content
        +
current conversation and stored chat history
        ↓
The Pattern's privately hosted model
        ↓
conversational response
```

Only the broad boundaries are documented. The company says the model is privately hosted on its own infrastructure, is not ChatGPT or another third-party AI, draws on thousands of human-created insights and audio recordings, and is not trained on personal chat data. It does not say whether the proprietary material was used for model training, fine-tuning, retrieval, prompt injection, or some hybrid.

### What remains unknown

The Pattern has not publicly disclosed:

* model family, parameter count, weights, license, or upstream developer;
* whether “own private model” means an internally trained model or a privately deployed open-weight model;
* base-model training sources;
* whether Pattern content is retrieved at inference time or encoded through fine-tuning;
* context-window size and conversation summarization;
* chart-fact serialization;
* retrieval or ranking algorithm;
* system and developer prompts;
* temperature, sampling, or deterministic controls;
* input or output classifiers;
* evaluation suites, red-team results, or measured failure rates;
* whether different features use different models;
* encryption-at-rest design, zero-access encryption, trusted execution, or an independently verified privacy boundary.

“Self-hosted” reduces one vendor-exposure path. It does not, by itself, mean end-to-end encrypted, inaccessible to company systems, or independently private.

## 1.2 Astronomical and interpretive data sources

### Documented sources

The Pattern discloses:

* Whole House astrology;
* user birth date, birth time, and birth location;
* human-created insights and audio recordings;
* decades of internal astrological research;
* natal positions, transits, compatibility factors, progressed Moon cycles, and relationship-axis factors in its public explanatory content.

### Undisclosed sources

No reviewed first-party source identifies:

* the astronomical ephemeris;
* its coordinates database;
* its historical daylight-saving/time-zone database;
* how ambiguous locations are resolved;
* how birth times are normalized to UTC;
* how missing birth times are handled internally;
* the provenance, authorship, licensing, or revision history of individual interpretation records.

That omission matters. A personalized chart can change because of a time-zone rule, historical daylight-saving correction, coordinates, house calculation, node choice, orb policy, or birth-time rounding even before any prose is generated.

The Pattern’s public chart page advises users to move a birth time one hour forward or backward when a result “feels off,” attributing possible discrepancies to daylight saving. That may help users explore alternate charts, but it is not a controlled time-zone correction process. Subjectively selecting the result that feels most accurate reduces reproducibility and can amplify confirmation bias.

## 1.3 User information collected and potentially available to the system

The current privacy policy describes a broad profile.

### Required or ordinary profile information

The Pattern may collect:

* name or alias;
* username;
* birth date;
* precise birth time;
* country, state, and city of birth;
* email;
* phone number;
* Apple ID;
* location;
* gender preference;
* profile photo;
* AI-chat questions and responses.

### Optional social and dating information

Connect profiles may include:

* employer or employment;
* education;
* height;
* biography;
* additional photos;
* lifestyle interests;
* drinking and smoking preferences;
* religion;
* whether the user has or wants children;
* gender and age preferences;
* location and distance preferences;
* answers to profile prompts.

### Device and behavioral information

The privacy policy also allows collection of:

* device type and family;
* operating system;
* carrier;
* device identifier;
* browser and language;
* time zone;
* login dates and times;
* features visited;
* searches;
* latitude and longitude;
* engagement, demographic, interest, location, and behavioral information used for aggregated research.

The App Store label separately reports contact details, identifiers, user content, product interactions, diagnostics, and optional contacts. Apple explicitly notes that these disclosures are supplied by the developer and are not independently verified by Apple.

### Information about other people

This is particularly important. The service supports:

* compatibility reports involving another person;
* conversations about friends, family, coworkers, and romantic interests;
* conversations that the company explicitly says can concern **prospective employees**;
* discussion of third parties inside AI chats.

The privacy policy warns that the AI may inadvertently process or disclose identifiers, biographical information, birth data, and inferred behavioral patterns about other users mentioned in a conversation. It places responsibility on the user to obtain the other person’s consent.

This is an inadequate boundary for employment use. Astrological or AI-inferred information about a candidate should not be used in hiring, promotion, compensation, or termination decisions.

## 1.4 Prompt engineering

### What is documented

The existence of hidden operational instructions is indirectly acknowledged by the Terms. Users are prohibited from attempting to:

* bypass safety restrictions;
* use prompt injection or role-play to override system behavior;
* extract system prompts or training data;
* modify operational parameters;
* conduct adversarial testing.

That proves the product anticipates prompt-level attacks. It does **not** establish that the technical defenses are effective.

### What can reasonably be inferred

A useful In-Depth response probably requires a context envelope containing some combination of:

```text
system role and voice
safety and scope instructions
user's natal-chart factors
selected transits or relationship factors
subject's chart factors
relevant Pattern-authored passages
prior conversation or a summary of it
current user message
```

That is an architectural inference. None of the following can be established publicly:

* whether the chart context is JSON, prose, tags, or tool output;
* whether content retrieval is lexical, rule-based, vector-based, or precomputed;
* whether the model receives all chart factors or a preselected subset;
* whether the same system prompt is used for self, relationship, and workplace conversations;
* whether “Pattern voice” is produced by fine-tuning, few-shot examples, retrieved passages, or instructions;
* whether an output validator checks astrological consistency;
* whether the system is prevented from inventing chart placements not supplied in context.

## 1.5 Guardrails

### Documented product-level controls

The Terms tell users that:

* the AI is not human;
* it is for entertainment;
* it is not medical or mental-health care;
* it may fail to understand information;
* its results may be unreliable;
* outputs may contain hallucinations;
* users must not attempt jailbreaks or prompt extraction.

The broader community guidelines prohibit hate, violent threats, self-harm encouragement, harassment, illegal activity, terrorism, and disclosure of personal information. Those rules govern user and community content; they are not evidence that every AI output passes an equivalent output classifier.

### Human monitoring and crisis handling

The Pattern describes In-Depth conversations as private to the user and “unmoderated.” Its privacy policy says messages are processed through automated systems, are not routinely monitored by staff, and that requests for medical help or other emergencies are **not forwarded to a person for action**.

Therefore, the public evidence shows:

* no routine human review;
* no documented human escalation path;
* no disclosed crisis intervention;
* no disclosed output moderation;
* no disclosed dependency, delusion, manipulation, or emotional-overreliance safeguards;
* no disclosed guardrail against employment decisions, even though prospective employees are named as a possible discussion subject.

A disclaimer is not an operational safety control. Prohibiting users from testing the system is also not a substitute for publishing internal or independent safety evidence.

## 1.6 Privacy, retention, and contractual treatment of chats

The product says chat histories are private to the user. The legal documents are materially broader.

The Terms expressly include messages to the AI in “User Content,” say there is no confidentiality or privacy with respect to submitted User Content, and grant The Pattern a perpetual, royalty-free, freely sublicensable license to modify, combine, transmit, translate, distribute, publicly display, publicly perform, and otherwise exploit that content, including commercially.

This does not necessarily mean the company actively publishes chat messages. It does mean that **“private in the product interface” is not the same as legally confidential or contractually restricted to inference-only use**.

The privacy policy says:

* chats may be processed, analyzed, and stored;
* statistical information may go to service providers to improve response times;
* vendors and service providers can receive information needed to operate the service;
* information may transfer in a financing, merger, acquisition, or asset sale;
* chat data is retained while the user uses the service;
* chat data may remain in anonymized form after account deletion.

The company separately claims that personal chats are not used to train the model and that it does not sell or expose those chats. Those are first-party claims, not independently audited technical guarantees.

### The Pattern verdict

**Strengths**

* A first-party, privately hosted model can reduce exposure to external model providers.
* The underlying interpretive corpus is described as human-created rather than scraped from arbitrary internet astrology content.
* The company clearly acknowledges hallucinations and the non-human nature of the system.

**Material weaknesses**

* No chart-calculation provenance.
* No model or prompt transparency.
* No published safety evaluation.
* No disclosed output moderation.
* No emergency escalation.
* Third-party personal information is deliberately in scope.
* Prospective-employee analysis is explicitly suggested.
* The legal definition and licensing of chat content are much broader than the ordinary meaning of a private conversation.
* “Unmoderated” is marketed as a privacy feature even though it simultaneously removes a potential safety backstop.

---

# 2. Co–Star

## 2.1 Disclosed system architecture

Co–Star provides the most detailed public description of a modern generation pipeline.

```text
birth date, exact time, and location
        ↓
NASA JPL planetary data
        ↓
natal chart and current transits
        ↓
astrological rules and proprietary interpretation database
        ↓
rules-based NLG + GPT-like model + staff-written material
        ↓
behavior-based ranking or question-specific selection
        ↓
personalized text
```

Its public site says it turns birth day, time, and place into a chart, maps that chart against current planetary locations, compares it with friends’ charts, and uses AI to translate the resulting data into language.

The live jobs page is more specific: Co–Star says it generates millions of personalized horoscopes through rules-based natural-language generation combining state-of-the-art models “like GPT” with the insights of staff poets. It also says writers work directly with AI models and that the company conducts A/B testing and uses behavioral data in product decisions.

“Like GPT” describes a model class or analogy. It does not establish that Co–Star currently uses OpenAI, which exact GPT release it might use, or whether the current production model changed after that page was written.

## 2.2 Astronomical and interpretive data

### Astronomical inputs

Co–Star says it uses NASA Jet Propulsion Laboratory data to calculate planetary positions. Its FAQ identifies:

* birth time;
* birth date;
* birth location;
* natal placements;
* current transits;
* friend-chart comparisons.

Its published methodology uses the tropical zodiac and the Porphyry house system.

The company does not publicly identify:

* the precise JPL development ephemeris release;
* its time-zone or geocoding database;
* orb tables;
* aspect-selection rules;
* transit-priority rules;
* rounding policies;
* handling of uncertain birth times;
* versioning of chart-calculation logic.

### Interpretive corpus

For Ask the Stars, Co–Star says every answer draws from a proprietary database constructed over five years by poets, astrologers, and technologists. Questions are parsed to identify relevant natal placements and transits, and those factors are matched to corresponding astrology in the database.

This supports a pipeline containing at least:

1. natural-language question parsing;
2. chart-feature selection;
3. retrieval or rule-based lookup into a proprietary corpus;
4. generated or assembled prose.

It does not reveal whether the corpus is:

* inserted directly into a model prompt;
* converted into embeddings;
* encoded as rules;
* used as fine-tuning data;
* split into reusable textual fragments;
* transformed into an intermediate semantic representation.

The broader horoscope pipeline likely predates Ask the Stars and appears to combine rule-selected content with neural text generation or rewriting.

## 2.3 Behavioral ranking

Co–Star does not present the same content to every user with the same chart. Its FAQ says it uses past in-app behavior to decide which transits to rank prominently on the home screen. The company gives an example in which repeated engagement with work-related material may contribute to displaying a work-oriented interpretation.

That means personalization is based on at least two layers:

```text
astrological eligibility:
Which readings could apply to this chart today?

behavioral salience:
Which eligible readings should this user see most prominently?
```

This is an important distinction. A user may perceive a surfaced reading as dictated by the chart when its prominence was partly selected by an engagement model. Co–Star does not publish the ranking objective, feature weights, diversity constraints, exploration policy, or controls for resetting or disabling behavioral personalization.

## 2.4 Ask the Stars pipeline

The documented flow is approximately:

```text
question
   ↓
safety and crisis eligibility check
   ↓
question parser
   ↓
relevant natal placements and real-time transits
   ↓
corresponding records from proprietary interpretation database
   ↓
undisclosed generation or assembly process
   ↓
answer
```

Co–Star says the product can address questions such as whether to quit a job and move countries, why the user is self-sabotaging, whether the user will fall in love, and what to do when the user no longer loves a partner.

Those are consequential topics. The system’s stated purpose is reflection rather than binding advice, but the product is clearly designed to influence relationship, career, and life decisions.

## 2.5 Prompt engineering

### Documented facts

Public evidence establishes:

* rule-based natural-language generation;
* GPT-like models;
* staff poets and writers working with AI;
* a proprietary interpretation database;
* a question parser;
* chart and transit selection;
* behavior-based ranking.

### Unknowns

Co–Star has not disclosed:

* the model provider;
* model name or version;
* system prompt;
* writer/style prompt;
* few-shot examples;
* whether it uses fine-tuning;
* whether it uses retrieval-augmented generation;
* whether the proprietary database is embedded or rule-indexed;
* prompt length or context composition;
* sampling parameters;
* prompt-version tracking;
* output schema;
* astrological fact validator;
* anti-hallucination mechanisms;
* whether generated passages are cached and reused;
* whether staff approve output templates or individual responses.

A likely but unverified prompt shape would be:

```text
voice and style instructions
safety boundaries
selected natal and transit facts
selected proprietary interpretation records
behavioral or question-derived focus
current user question
```

No exact wording can be recovered from public evidence.

## 2.6 Guardrails

Co–Star has the strongest publicly documented **question-level** safety policy of the three.

The FAQ says it does not answer questions it judges unsafe, toxic, harmful, or hurtful. It also refuses questions that appear to indicate a risk to the user or another person and directs the user to mental-health and other crisis resources.

Other documented controls include:

* a willingness disclaimer telling users not to follow the stars blindly;
* failure handling when the question cannot be parsed;
* English-only parsing at the time of the FAQ;
* credit restoration when a question cannot be answered.

### What is not disclosed

There is no public evidence explaining:

* whether the safety gate is rules-based, model-based, or both;
* classifier provider or version;
* thresholds and false-positive/false-negative rates;
* whether outputs pass a second safety check;
* whether answers are checked for self-harm encouragement after generation;
* human review or escalation;
* jailbreak and prompt-injection defenses;
* dependency or emotional-manipulation policies;
* disallowed medical, legal, financial, or employment advice;
* safety coverage across languages;
* adversarial test sets;
* red-team results;
* incident-reporting processes.

The privacy policy says service providers may perform content moderation, but it does not specify whether this applies to AI questions, AI outputs, social content, or all three.

## 2.7 User information

Co–Star’s product and FAQ identify:

* exact birth date;
* exact birth time;
* birth location;
* phone number or Apple account;
* username;
* friend connections;
* friends’ chart data;
* questions submitted to Ask the Stars;
* in-app behavior used for ranking;
* social content and messages where those features are used.

Its website also accepts city, date, time, and email for chart generation and emailed horoscopes.

The privacy policy is less explicit about its full field inventory than the product FAQ. It broadly covers information supplied by users and automatically collected information, but its deletion process confirms that the account is associated with phone number, username, and birth date, time, and location.

## 2.8 Privacy and retention

The current privacy policy, dated December 11, 2025, says:

* Co–Star does not sell personal information;
* it does not share it for targeted or cross-context behavioral advertising;
* service providers and partners may receive data for hosting, platform operation, content moderation, analytics, email, event administration, payments, and related functions;
* personal information is generally stored on AWS servers in the United States;
* retention is purpose-based rather than governed by a single published duration;
* information may be deleted or deidentified when no longer needed;
* services are restricted to users aged 16 and older.

Users can delete an account in the app. A manual deletion request requires the account phone number, username, and birth date, time, and location. The policy does not disclose a fixed maximum deletion-completion period or a specific retention period for Ask the Stars questions.

The Terms grant Co–Star a perpetual, irrevocable, transferable, worldwide, fully sublicensable license to uploaded content for use in connection with its business. Whether an Ask the Stars question is always treated as “Uploaded Content” is not expressly clarified in the excerpted provision, but users should not assume that all submitted text is contractually limited to answering the immediate request.

## 2.9 Midjourney acquisition

Midjourney acquired Co–Star in spring 2026; the transaction was publicly reported in July. Co–Star’s roughly two-dozen-person team joined Midjourney, founder Banu Guler became Midjourney’s chief design officer, and Midjourney said Co–Star would continue operating under her control.

No reliable public evidence currently shows that:

* Co–Star has switched to Midjourney models;
* its user data has been combined with Midjourney data;
* Midjourney is training models on Co–Star questions;
* its chart or language pipeline has materially changed after the acquisition.

The ownership change creates a future governance and subprocessor question, but it is not evidence of a current technical integration.

### Co–Star verdict

**Strengths**

* Identifies NASA JPL as an astronomical source.
* Discloses rules-based NLG, GPT-like models, and human writers.
* Identifies a proprietary interpretation corpus and question-parsing stage.
* Publicly acknowledges behavioral ranking.
* Provides an explicit crisis/refusal path.

**Material weaknesses**

* Exact model and prompts remain undisclosed.
* No public output-safety or hallucination testing.
* No published explanation of ranking objectives.
* No fixed question-retention period.
* Allows consequential career and relationship questions.
* No evidence of an astrological fact-consistency validator.
* Current ownership creates unresolved future data-governance questions.

---

# 3. Astro.com / Astrodienst

## 3.1 The disclosed computational pipeline

Astro.com is the most technically reproducible at the **astronomical-calculation layer**.

```text
birth date, time, and location
        ↓
Astrodienst geographic and historical time-zone atlas
        ↓
Swiss Ephemeris / JPL planetary calculations
        ↓
structured chart factors
        ↓
Prolog expert-system rules
        +
human-authored interpretation modules
        ↓
assembled Astro*Intelligence report
```

Swiss Ephemeris source code and documentation are publicly available. Astrodienst also provides direct access instructions for JPL data files including DE200, DE406, DE431, and DE441. Swiss Ephemeris is available under an open-source AGPL arrangement or a paid professional license, depending on the application.

Public Swiss Ephemeris source code does not make the complete Astro.com product open source. The website, report-selection logic, Prolog knowledge base, and licensed interpretation content remain separate.

## 3.2 Geographic and historical time data

Astrodienst provides substantially more provenance than the two mobile apps.

Its atlas says geographic coordinates come from:

* GeoNames;
* Thomas G. Shanks’ *The American Atlas* and *The International Atlas*;
* data gathered by Astrodienst since 1980.

Its disclosed historical time-zone sources include:

* the public TZ/IANA-style database, especially from 1970 onward;
* Doris Chase Doane’s time-change reference books;
* Shanks’ atlases for pre-1970 North American irregularities;
* additional European and international reference books;
* Astrodienst’s original research using newspaper archives, old airport data, and railway timetables.

The current public atlas page identifies its public TZ database as **version 2023d**. That does not conclusively prove that every production service remains frozen at 2023d, but it is the only publicly disclosed version on the reviewed current page. Post-2023 time-zone updates therefore cannot be verified from the documentation alone.

## 3.3 Interpretation system and “AI”

Astrodienst’s published history says it ported a Prolog interpreter to HP/9000 systems in October 1985 and used Prolog to model astrological rules and concepts. The Psychological Horoscope Analysis followed in March 1987.

The objective was not merely to attach isolated paragraphs to individual placements. Astrodienst and Liz Greene sought to create an expert system capable of synthesizing multiple chart factors into a description of character and psychological motivation resembling an astrological consultation. Greene described the distinction as synthesis through an expert system rather than linear interpretation of individual factors.

Its named interpretation sources include:

* Liz Greene;
* Robert Hand;
* Mona Riegger;
* additional AstroText and licensed-report authors.

This is classical symbolic AI:

```text
facts:
planet positions, houses, aspects, transits, chart relationships

rules:
astrological concepts, interaction logic, priorities, conflicts

content:
authored interpretive passages

inference:
select and synthesize a coherent report
```

It is not prompt engineering in the current LLM sense.

## 3.4 The prompt-engineering analogue

For Astro.com, the closest equivalents to a system prompt are:

* Prolog facts and rules;
* chart-feature normalization;
* rule precedence;
* conflict-resolution logic;
* thresholds and orbs;
* interpretation-module metadata;
* content-selection logic;
* report structure and narrative ordering.

These artifacts are potentially more deterministic and auditable than a free-form LLM prompt, but the complete knowledge base is not public. Therefore:

* planetary calculations can be independently reproduced;
* geographic and time-zone provenance can be substantially inspected;
* the exact interpretive synthesis cannot be independently reproduced;
* the current production version and evolution of the Prolog rules are unknown.

The historical documentation also does not establish that every current free or paid Astro.com report uses the identical 1980s implementation. It establishes the disclosed architecture and lineage for Astro*Intelligence reports.

## 3.5 Guardrails and failure modes

Astro.com largely avoids the characteristic safety problems of open-ended chat because the user supplies structured chart data and selects a predefined report. There is no arbitrary prompt to inject and no stochastic conversational model publicly identified.

That reduces exposure to:

* prompt injection;
* jailbreaks;
* free-form invention of unrelated facts;
* crisis conversations;
* unpredictable model role-play;
* cross-session conversational dependency.

It does not eliminate:

* incorrect birth or time-zone data;
* incorrect or outdated historical location rules;
* contradictory expert-system rules;
* inappropriate psychological interpretation;
* deterministic stereotyping;
* excessive user reliance;
* privacy concerns involving another person’s stored birth data;
* lack of scientific validation for the interpretive claims.

A deterministic system can produce the same unsupported conclusion very reliably.

No public model card, formal bias study, psychological-safety evaluation, or external validation of the interpretive rules surfaced in this research.

## 3.6 User information and retention

Astrodienst says general site content can be viewed anonymously, while registration is required to create and retain personalized horoscopes. A profile can contain up to 100 birth-data records and be accessed across devices.

Registered profile information can include:

* email;
* password;
* title;
* first and last name;
* country;
* language preferences.

Purchases can additionally involve:

* postal address;
* phone number;
* payment preference;
* order-related notes;
* birth dates associated with ordered reports.

Astrodienst says full credit-card numbers and security codes are handled by an external payment provider and are not visible to or stored by Astrodienst.

Deleting a profile makes it inaccessible through the site, but Astrodienst ordinarily retains it for six months to allow restoration. Immediate irreversible deletion can be requested by email. Records connected with purchases are retained for ten years under the company’s stated Swiss recordkeeping obligations.

The privacy statement visible during this review says it was last updated on March 6, 2023. That is older than the current policies of The Pattern and Co–Star and leaves more recent operational changes difficult to assess.

### Astro.com verdict

**Strengths**

* Best astronomical-source provenance.
* Public calculation library and documentation.
* Detailed geographic and historical time-zone sourcing.
* Named human authors.
* Deterministic expert-system architecture.
* Far less exposure to open-ended generative-AI failures.

**Material weaknesses**

* Exact interpretation rules remain proprietary.
* Current production rule versions are not disclosed.
* Public time-zone documentation identifies a 2023 database release.
* Privacy policy documentation is dated 2023.
* No public safety, bias, or interpretive-validity evaluation.
* Up to 100 birth records may include people who never consented to having their information stored or interpreted.

---

# 4. What is actually known about the prompts and models

| Question                       | The Pattern                                                      | Co–Star                                                                         | Astro.com                                                         |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Exact production model         | Unknown; described only as an internally hosted private model    | Unknown; live company materials say models “like GPT”                           | No modern production LLM identified                               |
| External model provider        | Company says no third-party AI for In-Depth                      | Unknown                                                                         | Not applicable to disclosed expert-system layer                   |
| Exact system prompt            | Not public                                                       | Not public                                                                      | Not an LLM prompt                                                 |
| Prompt/version history         | Not public                                                       | Not public                                                                      | Prolog/rule version history not public                            |
| Fine-tuning                    | Unknown                                                          | Unknown                                                                         | Not applicable in the modern sense                                |
| Retrieval-augmented generation | Possible but unconfirmed                                         | Strongly suggested by question-to-database matching, but implementation unknown | Rule and content lookup rather than disclosed vector RAG          |
| Training corpus                | Base-model corpus unknown; proprietary insights/audio identified | Base-model corpus unknown; proprietary astrological database identified         | Named authored materials and encoded expert knowledge             |
| Chat data used for training    | Company says no                                                  | Not specifically resolved in the reviewed disclosures                           | No chat feature in the disclosed core pipeline                    |
| User-behavior personalization  | Possible usage information collected, exact AI use unknown       | Explicitly documented for transit ranking                                       | No equivalent ranker publicly identified                          |
| Input safety                   | Contractual restrictions; technical implementation unknown       | Harmful/unsafe and crisis-question blocking                                     | Structured form inputs                                            |
| Output safety                  | Not disclosed                                                    | Not disclosed                                                                   | Constrained deterministic report generation                       |
| Human review                   | No routine chat review                                           | Not disclosed for generated answers                                             | Human-authored source material; current report QA process unknown |
| Published AI evaluations       | None found                                                       | None found                                                                      | None found                                                        |

---

# 5. Comparative guardrail assessment

## Strongest documented crisis control: Co–Star

Co–Star explicitly refuses questions that appear to pose a risk to the user or another person and directs users to crisis resources. The implementation and effectiveness remain unknown, but a concrete refusal path is at least publicly described.

## Weakest documented crisis handling: The Pattern

The Pattern tells users its AI is not mental-health care, but its policy also says emergency requests in chats are not forwarded to humans. No dedicated crisis refusal or resource-routing architecture is disclosed.

## Lowest generative-AI risk: Astro.com

Astro.com’s finite expert-system pipeline avoids many LLM-specific failure modes. That is an architectural advantage, not evidence that its interpretations are safe, unbiased, or empirically correct.

## Most significant confidentiality mismatch: The Pattern

The Pattern markets conversations as private to the user while its Terms say AI-chat messages are User Content without confidentiality and subject to a broad perpetual license. Product visibility, data security, legal confidentiality, and training restrictions are separate properties; the public messaging does not make those distinctions clear enough.

## Most significant hidden-personalization concern: Co–Star

Co–Star explicitly uses behavioral engagement to rank chart-eligible content, yet the product experience may lead users to attribute prominence solely to astrology. A responsible implementation would expose why a reading was selected and allow behavioral personalization to be reset or disabled.

## Best calculation reproducibility: Astro.com

Swiss Ephemeris, JPL inputs, geographic sources, and historical time-zone references provide the strongest foundation for independently reproducing chart facts. The proprietary rule and content layer still prevents complete report reproduction.

---

# 6. Major unanswered questions

The following information is not publicly available for The Pattern or Co–Star:

1. **Model identity and lineage**
   Model family, weights, upstream training data, release version, license, quantization, and serving stack.

2. **Exact context construction**
   Which chart facts, authored passages, behavior signals, relationship records, user attributes, and conversation turns are sent to the model.

3. **Prompt engineering**
   System prompts, style instructions, few-shot demonstrations, prompt order, tool definitions, and version history.

4. **Corpus transformation**
   Whether proprietary writings are used through retrieval, fine-tuning, template assembly, distillation, or direct prompt insertion.

5. **Fact validation**
   Whether outputs are checked against structured chart data to prevent invented placements, aspects, dates, or relationship factors.

6. **Safety architecture**
   Input classifiers, output classifiers, policies, thresholds, model vendors, multilingual coverage, human escalation, and incident response.

7. **Evaluation**
   Test-set composition, contradiction rate, hallucination rate, privacy leakage, self-harm performance, dependency behavior, demographic bias, and regression gates.

8. **Personalization objectives**
   Whether rankings optimize relevance, subscription conversion, time in app, sharing, emotional intensity, question purchases, or another target.

9. **Data deletion verification**
   Whether deletion propagates through logs, backups, analytics systems, embeddings, caches, model-training datasets, and service providers.

10. **Auditability**
    Prompt IDs, model IDs, corpus versions, evidence records, source attribution, and reproducible traces for individual outputs.

For Astro.com, the corresponding unknowns are the current Prolog knowledge base, rule priorities, content metadata, source-version mapping, and whether all current products still use the historically described expert-system implementation.

Determining these internals more precisely would require voluntary technical disclosure, an authorized architecture review, a data-protection impact assessment, a complete subprocessor list, model and prompt cards, versioned evaluation results, or controlled testing with company permission. The Pattern’s current Terms prohibit prompt extraction, reverse engineering, and adversarial testing, so unapproved attempts would not be an appropriate route.

---

# 7. A more defensible architecture for this category

A product intended to outperform these systems on evidence, privacy, and control should use this boundary:

```text
validated birth input
        ↓
versioned coordinates and historical time-zone resolution
        ↓
deterministic, tested chart JSON
        ↓
rule-selected interpretation candidates with source IDs
        ↓
policy and consent checks
        ↓
bounded LLM synthesis
        ↓
chart-fact validation + safety validation + privacy validation
        ↓
user-visible answer with provenance and limitations
```

## Requirements to implement now

### Separate calculation from language

The LLM should never calculate planetary positions, houses, aspects, or transit dates. It should receive immutable, schema-validated chart facts from a deterministic engine.

Record:

* ephemeris library and version;
* JPL dataset where applicable;
* time-zone database version;
* normalized UTC timestamp;
* coordinates and geocoder source;
* house system;
* zodiac;
* node selection;
* orb policy;
* chart-engine version.

### Use a licensed, attributable interpretation corpus

Every interpretation record should contain:

* author and source;
* copyright or license;
* editorial revision history;
* applicable chart factors;
* contraindications and exclusions;
* risk classification;
* source quotations or concept references;
* corpus version.

The generated answer should retain the source-record IDs that supported it.

### Make model context reviewable

Persist a structured trace containing:

* user-request ID;
* subject and consent status;
* chart-fact IDs;
* selected interpretation IDs;
* prompt-template version;
* model and model version;
* safety-policy version;
* response;
* validation findings;
* release status.

Sensitive text can be access-controlled or encrypted, but an attributable operational trace is necessary for debugging and redress.

### Add both input and output safety

At minimum, detect and handle:

* self-harm and harm to others;
* medical, mental-health, legal, and financial decisions;
* employment and education decisions;
* abuse, coercive control, stalking, or manipulation;
* delusional reinforcement;
* dependency or claims of supernatural certainty;
* protected-class inference;
* sexual content involving minors;
* third-party personal information;
* attempts to identify or diagnose another person;
* instructions to make irreversible decisions solely from astrology.

The output needs its own safety pass. Safe input does not guarantee safe generated text.

### Constrain third-party use

Do not allow a user to generate consequential interpretations about:

* job candidates;
* employees;
* patients;
* students;
* tenants;
* borrowers;
* insurance applicants;
* children outside a legitimate parent or guardian context.

A third-party chart should require an explicit relationship and consent declaration, minimal retention, and a clear prohibition against high-impact decision-making.

### Avoid the contractual problems seen here

Chats should not be covered by a perpetual commercial-content license. A clearer policy would specify:

* processing only to provide the requested feature;
* no training by default;
* explicit opt-in for product-improvement datasets;
* separate short retention for raw chats;
* deletion propagation;
* narrow service-provider access;
* no advertising use;
* no sale;
* no cross-product profiling;
* no use for employment or eligibility decisions.

### Publish evidence

A credible evaluation suite should test:

* chart-fact consistency;
* unsupported placement or transit invention;
* contradictions within one response;
* contradictions across repeated responses;
* source-faithfulness;
* privacy leakage;
* third-party information disclosure;
* self-harm and crisis behavior;
* medical and psychological overreach;
* deterministic language and fatalism;
* demographic stereotyping;
* emotional dependency;
* prompt injection;
* retrieval poisoning;
* missing or uncertain birth-time behavior;
* historical time-zone edge cases;
* model and prompt regressions.

## Additional differentiators

A stronger product could expose:

* “Why am I seeing this?” for every insight;
* source and corpus provenance;
* chart facts used;
* confidence and uncertainty;
* birth-time sensitivity;
* behavior-ranking controls;
* a personalization reset;
* a non-generative mode;
* a deterministic replay mode;
* corrections and user feedback tied to the exact output version;
* reversible deletion and auditable final deletion;
* public model, prompt, corpus, and safety change logs.

---

# Bottom line

**Astro.com is the strongest reference for calculation provenance and deterministic knowledge engineering. Co–Star is the clearest public example of combining chart facts, a proprietary corpus, human writers, rules-based NLG, GPT-like generation, question parsing, and behavior ranking. The Pattern makes the strongest private-infrastructure claim but discloses the least about model construction and has the most concerning gap between the ordinary meaning of a private chat and its contractual treatment of chat content.**

None presently offers the complete package required for an evidence-bounded system: versioned calculation provenance, licensed interpretation provenance, a reviewable context envelope, model and prompt identification, published evaluations, output-level safety enforcement, third-party consent controls, and a narrow privacy contract.
