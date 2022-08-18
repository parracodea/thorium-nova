import SearchableInput, {DefaultResultLabel} from "@thorium/ui/SearchableInput";
import {netRequest} from "client/src/context/useNetRequest";
import {useShipMapStore} from "./index";

export function CargoSearchInput() {
  return (
    <SearchableInput<{
      id: number;
      name: string;
      count?: number;
      type: "deck" | "room" | "inventory";
      room?: string;
      deck: string;
      deckIndex: number;
      roomId?: number;
    }>
      queryKey="cargo"
      placeholder="Search for rooms, cargo, and containers"
      getOptions={async ({queryKey, signal}) => {
        const result = await netRequest(
          "cargoSearch",
          {query: queryKey[1]},
          {signal}
        );
        return result;
      }}
      ResultLabel={({active, result, selected}) => (
        <DefaultResultLabel active={active} selected={selected}>
          <p>
            {result.name}
            {result.count ? ` (${result.count})` : ""}
          </p>
          {result.type !== "deck" && (
            <p>
              <small>
                {[result.room, result.deck].filter(Boolean).join(", ")}
              </small>
            </p>
          )}
        </DefaultResultLabel>
      )}
      setSelected={value => {
        if (!value) return;
        const {deckIndex, roomId} = value;
        useShipMapStore.setState({deckIndex});
        useShipMapStore.setState({selectedRoomId: roomId || null});
      }}
    />
  );
}
