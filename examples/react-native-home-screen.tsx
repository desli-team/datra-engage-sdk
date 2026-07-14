import { useMemo } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { DatraEngageProvider, useEngageMessages } from "@datra/engage-sdk/react";
import { DatraEngage } from "@datra/engage-sdk";

const engage = new DatraEngage({
  baseUrl: "https://api.datra.uz",
  publicKey: "pk_live_xxx",
  platform: "ios",
  appVersion: "1.5.0",
  locale: "ru",
  resolveTimeoutMs: 2000,
  eventQueue: true,
});

export function App() {
  return (
    <DatraEngageProvider client={engage}>
      <HomeScreen customerExternalId="customer_123" />
    </DatraEngageProvider>
  );
}

function HomeScreen({ customerExternalId }: { customerExternalId: string }) {
  const context = useMemo(() => ({ branchExternalId: "branch_1" }), []);
  const { messages, isLoading } = useEngageMessages("home", {
    customerExternalId,
    placement: "home_top_banner",
    context,
    trackShown: {
      idempotencyKeyPrefix: `home:${customerExternalId}`,
    },
  });

  if (isLoading || messages.length === 0) {
    return null;
  }

  const message = messages[0];
  return (
    <Pressable
      onPress={async () => {
        await engage.messageClickedSafe(message.decisionId);
      }}
      style={{
        borderRadius: 16,
        padding: 16,
        backgroundColor: "#101828",
      }}
    >
      {message.imageUrl ? (
        <Image
          source={{ uri: message.imageUrl }}
          style={{ height: 120, borderRadius: 12, marginBottom: 12 }}
        />
      ) : null}
      <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>
        {message.title}
      </Text>
      {message.body ? (
        <Text style={{ color: "#D0D5DD", marginTop: 6 }}>{message.body}</Text>
      ) : null}
    </Pressable>
  );
}
