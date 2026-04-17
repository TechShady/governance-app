import React, { useState } from "react";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Modal } from "@dynatrace/strato-components-preview/overlays";
import { NumberInput, FormField, Label } from "@dynatrace/strato-components/forms";
import { TimeframeSelector } from "@dynatrace/strato-components/filters";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Governance } from "./pages/Governance";
import type { Timeframe } from "@dynatrace/strato-components/core";

const DEFAULT_TIMEFRAME: Timeframe = {
  from: {
    absoluteDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    value: "now()-90d",
    type: "expression",
  },
  to: {
    absoluteDate: new Date().toISOString(),
    value: "now()",
    type: "expression",
  },
};

const HELP_CONTENT = [
  {
    title: "Top Used Dashboards",
    text: "Dashboards sorted by version (number of edits). Higher version means the dashboard has been actively maintained and updated.",
  },
  {
    title: "Top Unused Dashboards",
    text: "Dashboards sorted by last modification date (oldest first). These are stale dashboards that haven't been touched in the longest time.",
  },
  {
    title: "Top Owners",
    text: "Dashboard owners ranked by number of dashboards they own. Helps identify who creates and maintains the most dashboards.",
  },
  {
    title: "Top DQL Queries",
    text: "Most common DQL queries found across all dashboard tiles. Click 'Scan Dashboards' to download and analyze dashboard content. This may take some time for large environments.",
  },
  {
    title: "Cloned Dashboards",
    text: "Dashboards detected as clones by identical names or naming patterns such as 'Copy of...', '(copy)', '(1)', '(2)', and '- Copy'.",
  },
];

export const App = () => {
  const [topN, setTopN] = useState<number | null>(20);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);

  return (
    <Page>
      <Page.Header>
        <Header
          onSettingsClick={() => setSettingsOpen(true)}
          onHelpClick={() => setHelpOpen(true)}
        />
      </Page.Header>
      <Page.Main>
        <Flex padding={16}>
          <TimeframeSelector
            value={timeframe}
            onChange={(value) => { if (value) setTimeframe(value); }}
          />
        </Flex>
        <Routes>
          <Route path="/" element={<Governance topN={topN ?? 20} timeframe={timeframe} />} />
        </Routes>

        <Modal
          show={settingsOpen}
          title="Settings"
          size="small"
          onDismiss={() => setSettingsOpen(false)}
        >
          <FormField>
            <Label>Top N results</Label>
            <NumberInput value={topN} onChange={setTopN} />
          </FormField>
        </Modal>

        <Modal
          show={helpOpen}
          title="Governance - Help"
          size="large"
          onDismiss={() => setHelpOpen(false)}
        >
          <Flex flexDirection="column" gap={16}>
            {HELP_CONTENT.map((item) => (
              <div key={item.title}>
                <Heading level={5}>{item.title}</Heading>
                <Text>{item.text}</Text>
              </div>
            ))}
          </Flex>
        </Modal>
      </Page.Main>
    </Page>
  );
};
