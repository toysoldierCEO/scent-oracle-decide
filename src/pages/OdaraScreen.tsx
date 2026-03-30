const fetchOracle = useCallback(
  async (ctx?: string, temp?: number, excludeId?: string, wearDate?: string) => {
    const contextVal = ctx ?? selectedContext ?? "daily";
    const tempVal = temp ?? effectiveTemperature ?? 25;
    const dateForRpc = wearDate ?? selectedDateKey;
    const fetchId = ++latestFetchId.current;

    const dateKey = dateForRpc;
    console.log("ODARA current context", contextVal);
    console.log("ODARA found locked recipe", !!lockedRecipes.current[dateKey]?.[contextVal]);
    console.log("ODARA saved lock state", lockedRecipes.current[dateKey]?.[contextVal]?.lockState ?? "neutral");

    setLoading(true);
    setError(false);
    setExitDirection(null);

    try {
      const userId = await getUserId();

      const rpcParams = {
        p_user_id: userId,
        p_temperature: tempVal,
        p_context: contextVal,
        p_brand: null,
        p_wear_date: dateForRpc,
      } as any;

      const { data: rpcResult, error: rpcErr } = await supabase.rpc("get_todays_oracle_v4_spread", rpcParams);

      if (rpcErr) throw rpcErr;

      const result = rpcResult as any;
      const pick = result?.today_pick;

      if (fetchId !== latestFetchId.current || selectedContextRef.current !== contextVal) {
        console.log("ODARA stale fetch ignored for", contextVal);
        return;
      }

      console.log("[ODARA] Oracle RPC result:", result);

      if (!pick) throw new Error("No fragrance found for this context");

      // v4_spread does not return notes / accords / projection
      setMainNotes(null);
      setMainAccords(null);
      setMainProjection(null);

      const liveAlternates = (result.alternates ?? []).map((a: any) => ({
        fragrance_id: a.fragrance_id,
        name: a.name,
        family: a.family ?? "",
        reason: a.reason ?? "",
      }));

      // Pull full main fragrance details separately so the UI still has notes / accords / projection
      const { data: mainRow, error: mainErr } = await supabase
        .from("fragrances")
        .select("id, name, brand, family_key, notes, accords, projection")
        .eq("id", pick.fragrance_id)
        .single();

      if (!mainErr && mainRow) {
        setMainNotes(mainRow.notes ?? null);
        setMainAccords(mainRow.accords ?? null);
        setMainProjection(mainRow.projection ?? null);
      }

      // Fetch layer candidates from the table
      const excludeIds = [pick.fragrance_id, ...liveAlternates.map((a: any) => a.fragrance_id)].filter(Boolean);
      const excludeFilter =
        excludeIds.length > 0 ? `(${excludeIds.join(",")})` : "(00000000-0000-0000-0000-000000000000)";

      const { data: layerRows } = await supabase
        .from("fragrances")
        .select("id, name, brand, family_key, notes, accords, projection")
        .not("id", "in", excludeFilter)
        .not("family_key", "is", null)
        .limit(20);

      const newLayerModes = pickDiverseLayerModes(layerRows ?? [], pick.family ?? "");
      setLayerModes(newLayerModes);
      setLayerFragrance(newLayerModes.balance ?? null);
      setSelectedMood("balance");

      const liveOracle: OracleData = {
        today_pick: {
          fragrance_id: pick.fragrance_id,
          name: pick.name,
          family: pick.family ?? "",
          reason: pick.reason ?? pick.brand ?? "",
        },
        layer: null,
        alternates: liveAlternates,
      };

      setIsUnlockTransition(false);
      setSelectionState("neutral");
      setOracle(liveOracle);
      setCardKey((k) => k + 1);
    } catch (e) {
      if (fetchId !== latestFetchId.current || selectedContextRef.current !== contextVal) {
        console.log("ODARA stale fetch error ignored for", contextVal);
        return;
      }
      console.error("Oracle fetch failed:", e);
      setError(true);
    } finally {
      if (fetchId === latestFetchId.current && selectedContextRef.current === contextVal) {
        setLoading(false);
      }
    }
  },
  [selectedContext, effectiveTemperature, getUserId, selectedDateKey],
);
