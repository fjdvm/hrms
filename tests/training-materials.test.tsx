// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LaterCards } from "@/components/training/later-cards";
import { MaterialsCard } from "@/components/training/materials";

const actions = vi.hoisted(() => ({ requestMaterialUpload: vi.fn(), confirmMaterialUpload: vi.fn(), deleteTrainingMaterial: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

const handbook = { fileId: "f1", filename: "POS-Quick-Guide.pdf", contentType: "application/pdf", size: 1_258_291 };
const sheet = { fileId: "f2", filename: "Cash-Count-Sheet.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 92_160 };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.deleteTrainingMaterial.mockResolvedValue({});
});
afterEach(() => { cleanup(); Object.values(actions).forEach((fn) => fn.mockReset()); vi.unstubAllGlobals(); });

it("lists each material with its kind and size", () => {
  render(<MaterialsCard trainingId={4} initial={[handbook, sheet]} />);
  expect(screen.getByText("PDF · 1.2 MB")).toBeTruthy();
  expect(screen.getByText("Excel · 90 KB")).toBeTruthy();
});

it("says there are no materials yet when there are none", () => {
  render(<MaterialsCard trainingId={4} initial={[]} />);
  expect(screen.getByText("No materials yet")).toBeTruthy();
});

it("asks to confirm before deleting, and keeps the material when Staff back out", async () => {
  render(<MaterialsCard trainingId={4} initial={[handbook]} />);
  await userEvent.click(screen.getByRole("button", { name: "Delete POS-Quick-Guide.pdf" }));
  expect(screen.getByText("Delete this material?")).toBeTruthy();
  expect(actions.deleteTrainingMaterial).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Keep material" }));
  expect(actions.deleteTrainingMaterial).not.toHaveBeenCalled();
  expect(screen.getByText("POS-Quick-Guide.pdf")).toBeTruthy();
});

it("deletes the material once confirmed", async () => {
  render(<MaterialsCard trainingId={4} initial={[handbook, sheet]} />);
  await userEvent.click(screen.getByRole("button", { name: "Delete POS-Quick-Guide.pdf" }));
  await userEvent.click(screen.getByRole("button", { name: "Delete material" }));
  await waitFor(() => expect(screen.queryByText("POS-Quick-Guide.pdf")).toBeNull());
  expect(actions.deleteTrainingMaterial).toHaveBeenCalledWith("f1", 4);
  expect(screen.getByText("Cash-Count-Sheet.xlsx")).toBeTruthy();
});

it("uploads straight to the signed address, then confirms and lists the file", async () => {
  actions.requestMaterialUpload.mockResolvedValue({ fileId: "f9", uploadUrl: "https://files.test/put" });
  actions.confirmMaterialUpload.mockResolvedValue({ material: { fileId: "f9", filename: "Poster.png", contentType: "image/png", size: 1_153_434 } });
  const put = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", put);
  render(<MaterialsCard trainingId={4} initial={[]} />);
  await userEvent.upload(screen.getByLabelText("Choose material files"), new File(["x"], "Poster.png", { type: "image/png" }));
  await screen.findByText("Image · 1.1 MB");
  expect(put).toHaveBeenCalledWith("https://files.test/put", expect.objectContaining({ method: "PUT" }));
  expect(actions.confirmMaterialUpload).toHaveBeenCalledWith("f9", 4);
});

it("refuses a file type that is not allowed without contacting the server", async () => {
  render(<MaterialsCard trainingId={4} initial={[]} />);
  await userEvent.upload(screen.getByLabelText("Choose material files"), new File(["x"], "bad.zip", { type: "application/zip" }), { applyAccept: false });
  expect((await screen.findByRole("alert")).textContent).toMatch(/PDF, Word, Excel or image/);
  expect(actions.requestMaterialUpload).not.toHaveBeenCalled();
});

it("shows the two Later placeholders, with nothing to click", () => {
  render(<LaterCards />);
  expect(screen.getByText("Microlearning materials")).toBeTruthy();
  expect(screen.getByText("AI training recommendation")).toBeTruthy();
  expect(screen.getAllByText("Later")).toHaveLength(2);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
