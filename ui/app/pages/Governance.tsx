import React, { useState, useEffect, useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { documentsClient } from "@dynatrace-sdk/client-document";
import { usersAndGroupsClient } from "@dynatrace-sdk/client-iam";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";

interface DashboardMeta {
  id: string;
  name: string;
  owner: string;
  version: number;
  lastModifiedTime: Date | null;
  createdTime: Date | null;
}

function parseVersion(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseInt(v, 10) || 0;
  return 0;
}

interface GovernanceProps {
  topN: number;
  timeframe: { from: { absoluteDate: string }; to: { absoluteDate: string } };
}

function normalizeCloneName(name: string): string {
  let n = name;
  n = n.replace(/^Copy of\s+/i, "");
  n = n.replace(/\s*\(copy\)\s*$/i, "");
  n = n.replace(/\s*\(\d+\)\s*$/, "");
  n = n.replace(/\s*-\s*Copy\s*$/i, "");
  return n.trim();
}

export const Governance = ({ topN, timeframe }: GovernanceProps) => {
  const [dashboards, setDashboards] = useState<DashboardMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [dqlMap, setDqlMap] = useState<Record<string, number> | null>(null);
  const [dqlScanning, setDqlScanning] = useState(false);
  const [dqlProgress, setDqlProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        setLoading(true);
        setError(null);
        setDqlMap(null);
        const all: DashboardMeta[] = [];
        let nextPageKey: string | undefined;
        const fromDate = new Date(timeframe.from.absoluteDate);
        const toDate = new Date(timeframe.to.absoluteDate);

        do {
          const params: any = {
            filter: "type == 'dashboard'",
            pageSize: 1000,
          };
          if (nextPageKey) params.pageKey = nextPageKey;

          const response = await documentsClient.listDocuments(params);

          for (const doc of response.documents ?? []) {
            const lmt = doc.modificationInfo?.lastModifiedTime ?? null;
            if (lmt && (lmt < fromDate || lmt > toDate)) continue;
            all.push({
              id: doc.id ?? "",
              name: doc.name ?? "Untitled",
              owner: doc.owner ?? "Unknown",
              version: parseVersion(doc.version),
              lastModifiedTime: doc.modificationInfo?.lastModifiedTime ?? null,
              createdTime: doc.modificationInfo?.createdTime ?? null,
            });
          }

          nextPageKey = response.nextPageKey;
        } while (nextPageKey);

        if (!cancelled) {
          setDashboards(all);

          // Resolve owner UUIDs to display names
          const uniqueOwners = [...new Set(all.map((d) => d.owner).filter(Boolean))];
          const nameMap: Record<string, string> = {};
          try {
            const envId = getEnvironmentId();
            // IAM API allows max 25 UUIDs per call
            for (let i = 0; i < uniqueOwners.length; i += 25) {
              const batch = uniqueOwners.slice(i, i + 25);
              const resp = await usersAndGroupsClient.getActiveUsersForOrganizationalLevelPost({
                levelType: "environment",
                levelId: envId,
                body: batch,
              });
              for (const user of resp.results ?? []) {
                const display = [user.name, user.surname].filter(Boolean).join(" ") || user.email;
                nameMap[user.uid] = display;
              }
            }
          } catch {
            // IAM resolution failed — fall back to raw IDs
          }
          if (!cancelled) {
            setUserNames(nameMap);
            setLoading(false);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? "Failed to fetch dashboards");
          setLoading(false);
        }
      }
    };

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [timeframe]);

  // Most Active: highest version (most edits)
  const mostActive = useMemo(
    () =>
      [...dashboards].sort((a, b) => b.version - a.version).slice(0, topN),
    [dashboards, topN]
  );

  // Least Active: oldest lastModifiedTime
  const leastActive = useMemo(
    () =>
      [...dashboards]
        .sort((a, b) => {
          const ta = a.lastModifiedTime?.getTime() ?? 0;
          const tb = b.lastModifiedTime?.getTime() ?? 0;
          return ta - tb;
        })
        .slice(0, topN),
    [dashboards, topN]
  );

  // Top Owners by dashboard count
  const topOwners = useMemo(() => {
    const map: Record<string, number> = {};
    dashboards.forEach((d) => {
      map[d.owner] = (map[d.owner] ?? 0) + 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([owner, count]) => ({ owner, count }));
  }, [dashboards, topN]);

  // Cloned Dashboards: same normalized name with count > 1
  const topCloned = useMemo(() => {
    const groups: Record<string, { names: Set<string>; count: number }> = {};
    dashboards.forEach((d) => {
      const key = normalizeCloneName(d.name);
      if (!groups[key]) groups[key] = { names: new Set(), count: 0 };
      groups[key].names.add(d.name);
      groups[key].count++;
    });
    return Object.entries(groups)
      .filter(([, g]) => g.count > 1)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, topN)
      .map(([name, g]) => ({
        name,
        copies: g.count,
        variants: Array.from(g.names).join(", "),
      }));
  }, [dashboards, topN]);

  // DQL scan: downloads each dashboard content
  const dqlPrefixPattern = /^(fetch|timeseries|smartscapeEdges|smartscapeNodes)\b/i;

  const scanDql = async () => {
    setDqlScanning(true);
    setDqlProgress(0);
    const qMap: Record<string, number> = {};

    for (let i = 0; i < dashboards.length; i++) {
      setDqlProgress(Math.round(((i + 1) / dashboards.length) * 100));
      try {
        const binary = await documentsClient.downloadDocumentContent({
          id: dashboards[i].id,
        });
        const text = await binary.get("text");
        const json = JSON.parse(text);

        if (json.tiles) {
          for (const tile of Object.values(json.tiles) as any[]) {
            if (tile.query && typeof tile.query === "string") {
              const q = tile.query.trim();
              if (q && dqlPrefixPattern.test(q)) qMap[q] = (qMap[q] ?? 0) + 1;
            }
            if (Array.isArray(tile.queries)) {
              for (const tq of tile.queries) {
                const q = typeof tq === "string" ? tq : tq?.query;
                if (q && dqlPrefixPattern.test(q.trim())) qMap[q.trim()] = (qMap[q.trim()] ?? 0) + 1;
              }
            }
          }
        }
      } catch {
        // skip unreadable dashboards
      }
    }

    setDqlMap(qMap);
    setDqlScanning(false);
  };

  // Top DQL queries by occurrence
  const topDql = useMemo(() => {
    if (!dqlMap) return [];
    return Object.entries(dqlMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([query, count]) => ({ query, count }));
  }, [dqlMap, topN]);

  if (loading) {
    return (
      <Flex justifyContent="center" alignItems="center" padding={32}>
        <ProgressCircle />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex justifyContent="center" alignItems="center" padding={32}>
        <Text>Error: {error}</Text>
      </Flex>
    );
  }

  const resolveOwner = (ownerId: string) => userNames[ownerId] || ownerId;

  const dashboardColumns = [
    { header: "Name", accessor: "name", id: "name" },
    {
      header: "Owner",
      accessor: (row: DashboardMeta) => resolveOwner(row.owner),
      id: "owner",
    },
    { header: "Usage Count", accessor: "version", id: "version", sortType: "number" as const },
    {
      header: "Last Modified",
      accessor: (row: DashboardMeta) =>
        row.lastModifiedTime ? row.lastModifiedTime.toLocaleString() : "",
      id: "lastModifiedTime",
    },
  ];

  const ownerColumns = [
    {
      header: "Owner",
      accessor: (row: { owner: string; count: number }) => resolveOwner(row.owner),
      id: "owner",
    },
    { header: "Dashboard Count", accessor: "count", id: "count", sortType: "number" as const },
  ];

  const cloneColumns = [
    { header: "Dashboard Name", accessor: "name", id: "name" },
    { header: "Copies", accessor: "copies", id: "copies", sortType: "number" as const },
    { header: "Variants", accessor: "variants", id: "variants" },
  ];

  const dqlColumns = [
    { header: "DQL Query", accessor: "query", id: "query" },
    { header: "Count", accessor: "count", id: "count", sortType: "number" as const },
  ];

  return (
    <Flex flexDirection="column" padding={16} gap={16}>
      <Flex justifyContent="space-between" alignItems="center">
        <Heading level={4}>Dashboard Governance</Heading>
        <Text>
          Total dashboards: {dashboards.length} | Showing top {topN}
        </Text>
      </Flex>

      <Tabs defaultIndex={0}>
        <Tab title="Top Used">
          <DataTable data={mostActive} columns={dashboardColumns} sortable defaultSortBy={[{ id: "version", desc: true }]}>
            <DataTable.Pagination defaultPageSize={20} />
          </DataTable>
        </Tab>

        <Tab title="Top Unused">
          <DataTable data={leastActive} columns={dashboardColumns} sortable defaultSortBy={[{ id: "version", desc: false }]}>
            <DataTable.Pagination defaultPageSize={20} />
          </DataTable>
        </Tab>

        <Tab title="Top Owners">
          <DataTable data={topOwners} columns={ownerColumns} sortable defaultSortBy={[{ id: "count", desc: true }]}>
            <DataTable.Pagination defaultPageSize={20} />
          </DataTable>
        </Tab>

        <Tab title="Top DQL Queries">
          {!dqlMap ? (
            <Flex flexDirection="column" gap={8} padding={16}>
              <Text>
                Scanning downloads each dashboard to extract DQL queries from
                tiles. This may take a while for large environments.
              </Text>
              <Flex alignItems="center" gap={8}>
                <Button onClick={scanDql} disabled={dqlScanning}>
                  {dqlScanning
                    ? `Scanning... ${dqlProgress}%`
                    : "Scan Dashboards"}
                </Button>
                {dqlScanning && <ProgressCircle />}
              </Flex>
            </Flex>
          ) : (
            <DataTable data={topDql} columns={dqlColumns} sortable defaultSortBy={[{ id: "count", desc: true }]}>
              <DataTable.Pagination defaultPageSize={20} />
            </DataTable>
          )}
        </Tab>

        <Tab title="Top Cloned">
          <DataTable data={topCloned} columns={cloneColumns} sortable defaultSortBy={[{ id: "copies", desc: true }]}>
            <DataTable.Pagination defaultPageSize={20} />
          </DataTable>
        </Tab>
      </Tabs>
    </Flex>
  );
};
