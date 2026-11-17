import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import eventRoutes from "../routes/event.routes";
import Event from "../models/Event";
import { firebaseAuth } from "../config/firebase";
import * as excelService from "../services/excel.service";

vi.mock("../config/firebase", () => ({
  firebaseAuth: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock("../models/Event", () => {
  const mockModel: any = vi.fn();
  mockModel.find = vi.fn();
  mockModel.findOneAndUpdate = vi.fn();
  mockModel.findOneAndDelete = vi.fn();
  mockModel.insertMany = vi.fn();
  mockModel.deleteMany = vi.fn();
  return { default: mockModel };
});

vi.mock("../services/excel.service", () => ({
  parseExcel: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api/events", eventRoutes);

describe("Import Safety: Insert Before Delete & PII Protection (Item 12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValue({
      uid: "user-safe-123",
    } as any);
  });

  it("should insert new events before deleting old events and preserve existing records if insert fails", async () => {
    const callOrder: string[] = [];

    vi.mocked(excelService.parseExcel).mockReturnValueOnce([
      {
        Name: "Jane Doe",
        Email: "jane@example.com",
        EventType: "Birthday",
        EventDate: new Date("2026-05-10"),
        PhotoURL: "",
        Department: "Engineering",
        CustomMessage: "Happy Birthday Jane!",
      },
    ]);

    vi.mocked(Event.insertMany).mockImplementationOnce(async () => {
      callOrder.push("insertMany");
      throw new Error("Database Write Failed (e.g. storage error)");
    });

    vi.mocked(Event.deleteMany).mockImplementationOnce(async () => {
      callOrder.push("deleteMany");
      return {} as any;
    });

    // Create fake buffer
    const fakeBuffer = Buffer.from("fake-excel-data");

    const res = await request(app)
      .post("/api/events/import")
      .set("Authorization", "Bearer valid-token")
      .attach("file", fakeBuffer, "events.xlsx");

    expect(res.status).toBe(500);
    expect(callOrder).toEqual(["insertMany"]);
    // Crucial check: deleteMany was never called, keeping existing events safe
    expect(Event.deleteMany).not.toHaveBeenCalled();
  });

  it("should safely delete previous records only after successful insertion", async () => {
    const callOrder: string[] = [];

    vi.mocked(excelService.parseExcel).mockReturnValueOnce([
      {
        Name: "John Doe",
        Email: "john@example.com",
        EventType: "Anniversary",
        EventDate: new Date("2026-06-15"),
        PhotoURL: "",
        Department: "Sales",
        CustomMessage: "",
      },
    ]);

    const newInsertedEvents = [{ _id: "new-event-1", name: "John Doe" }];

    vi.mocked(Event.insertMany).mockImplementationOnce(async () => {
      callOrder.push("insertMany");
      return newInsertedEvents as any;
    });

    vi.mocked(Event.deleteMany).mockImplementationOnce(async () => {
      callOrder.push("deleteMany");
      return {} as any;
    });

    const fakeBuffer = Buffer.from("fake-excel-data");

    const res = await request(app)
      .post("/api/events/import")
      .set("Authorization", "Bearer valid-token")
      .attach("file", fakeBuffer, "events.xlsx");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(callOrder).toEqual(["insertMany", "deleteMany"]);
    expect(Event.deleteMany).toHaveBeenCalledWith({
      userId: "user-safe-123",
      source: "excel",
      _id: { $nin: ["new-event-1"] },
    });
  });
});
