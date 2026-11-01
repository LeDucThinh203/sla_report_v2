# DECISIONS

## 1. What I Assumed

- **Business hours:** Response time is calculated using each building's local working hours, excluding holidays and non-working days. This ensures fair comparisons between Singapore, Sydney, and Jakarta.
- **Response targets:** High-priority requests have a 60-minute target, Medium 240 minutes, and Low or unspecified priority 480 minutes. Only business-hours minutes count.
- **First responder:** The first employee who starts processing a request is considered its responder. Automated system activities do not count.
- **Corrected activities:** If an activity is reversed, both the original and reversing activities are ignored to avoid incorrect results.
- **Completion deadlines:** Late completion is determined by comparing the latest completion with the latest recorded deadline, including requests that were reopened.
- **Missing information:** Requests without a response or completion are displayed with unavailable values rather than misleading results.
- **Report eligibility:** Requests are selected using each building's local creation date. Canceled, deleted, and merged requests are excluded.

## 2. What I Found in the API or Data

- **Large dataset:** The practice API contains approximately 12,004 requests and 45,921 activities. Fetching each request separately would create too many API calls, so I used the change feed to load data efficiently.
- **Different schedules:** Singapore, Sydney, and Jakarta have different working hours and holidays. Jakarta also operates on Saturday mornings, while Sydney has daylight saving time.
- **Unexpected records:** Request 63467 has a response timestamp earlier than its creation time, so its response duration is treated as zero according to the rules.
- **Reopened requests:** Requests 64116 and 64398 have updated deadlines after being reopened. The report follows the latest applicable deadline.
- **Reversed activities:** The practice data contains 195 reversing events, which must be excluded together with their original events.
- **Live changes:** Helpdesk information changes while the application runs. I implemented automatic synchronization so reports can reflect new information without restarting the application.
- **API reliability:** The application handles temporary rate limits and expired synchronization positions by retrying or rebuilding data when necessary.

## 3. What I Built and Measured

- **Performance dashboard:** Managers can select a date range and view total requests, response target results, late completions, and average response time.
- **Employee performance:** A separate table shows requests handled, responses within target, and late completions for each employee.
- **Request browsing:** Users can filter by building, employee, response status, or completion status, then sort and navigate through pages.
- **Reliable pagination:** Request lists remain consistent during browsing, reducing the risk of duplicated or skipped records when data changes.
- **CSV export:** Following the client's additional request, I added a Download CSV button. It exports every matching request using the selected filters and sorting, ready for Excel.
- **Recorded startup time:** Approximately 23.87 seconds to prepare the practice dataset.
- **Recorded report times:** Approximately 0.96 seconds for six months and 0.23 seconds for one month on the first calculation, both below the required limits.
- **Testing:** The project includes automated tests for reporting rules, filtering, pagination, synchronization, and CSV formatting.

These measurements were recorded using the practice dataset and may vary in other environments.

## 4. How I Used AI

- **Tool used:** Antigravity, an AI coding assistant.
- **Purpose:** I used AI to help review the requirements, organize the Node.js and React application, identify unusual data cases, and develop automated tests.
- **What needed improvement:** An early synchronization approach could expose incomplete updates. I changed it to apply a complete batch of changes together.
- **Pagination improvement:** I improved the handling of browsing sessions so they expire appropriately and invalid page positions are rejected.
- **CSV improvement:** I separated CSV export handling from normal pagination because Excel downloads must include all matching requests, not just one page.
- **My responsibility:** I reviewed the implementation against the provided rules and adjusted the code when the initial approach did not fully meet the requirements.

## 5. Trade-offs and What I Would Do Next

- **In-memory storage:** I chose to keep synchronized data in memory for fast reports and simple Docker setup. The limitation is that restarting the application requires loading the data again. In production, I would add persistent storage.
- **Consistent pagination:** I preserve a stable list while users navigate between pages. This improves reliability but temporarily uses additional memory.
- **CSV generation:** The current approach prepares the complete export in memory, which works well for the practice dataset. For much larger datasets, I would generate the file progressively.
- **Future improvements:** I would prioritize persistent storage, stronger operational monitoring, and additional reporting options based on customer feedback.

The main goal was to deliver an accurate, fast, and easy-to-use dashboard that helps Bluebay Properties monitor service performance and export useful reports.
