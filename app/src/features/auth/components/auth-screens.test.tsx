import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { ApiError, NetworkError } from "@/lib/api-errors";
import { EmailForm } from "./email-form";
import { CodeForm } from "./code-form";

describe("EmailForm", () => {
  it("emailIsTrimmedAndLowercasedBeforeSending", async () => {
    const requestCode = jest.fn(() => Promise.resolve());
    const onSent = jest.fn();
    await render(<EmailForm requestCode={requestCode} onSent={onSent} />);
    await fireEvent.changeText(screen.getByLabelText("Email"), " Priya@Example.COM ");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("priya@example.com"));
    expect(requestCode).toHaveBeenCalledWith("priya@example.com");
  });

  it("validates before sending", async () => {
    const requestCode = jest.fn(() => Promise.resolve());
    await render(<EmailForm requestCode={requestCode} onSent={() => {}} />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "not-an-email");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(requestCode).not.toHaveBeenCalled();
  });

  it("shows the rate-limit message inline (ERR-13)", async () => {
    const requestCode = jest.fn(() => Promise.reject(new ApiError("RATE_LIMITED", 429, "slow down")));
    await render(<EmailForm requestCode={requestCode} onSent={() => {}} />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "a@b.co");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("Too many requests. Wait a minute and try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled();
  });

  it("shows the offline message and keeps the draft", async () => {
    const requestCode = jest.fn(() => Promise.reject(new NetworkError("offline")));
    await render(<EmailForm requestCode={requestCode} onSent={() => {}} />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "a@b.co");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("No connection. Check your network and try again.")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toHaveProp("value", "a@b.co");
  });
});

describe("CodeForm", () => {
  const pair = { accessToken: "A", refreshToken: "R", expiresIn: 900 };

  it("pastedCodeKeepsDigitsOnly and submits at six digits", async () => {
    const verifyCode = jest.fn(() => Promise.resolve(pair));
    const onVerified = jest.fn();
    await render(
      <CodeForm
        email="a@b.co"
        verifyCode={verifyCode}
        requestCode={() => Promise.resolve()}
        onVerified={onVerified}
      />,
    );
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123 456");
    await waitFor(() => expect(verifyCode).toHaveBeenCalledWith("a@b.co", "123456"));
    expect(onVerified).toHaveBeenCalledWith(pair);
    expect(screen.getByTestId("code-box-5")).toHaveTextContent("6");
  });

  it("ignores letters and caps at six", async () => {
    await render(
      <CodeForm
        email="a@b.co"
        verifyCode={() => Promise.resolve(pair)}
        requestCode={() => Promise.resolve()}
        onVerified={() => {}}
      />,
    );
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "12ab3");
    expect(screen.getByTestId("code-box-2")).toHaveTextContent("3");
    expect(screen.getByTestId("code-box-3")).toHaveTextContent("");
  });

  it("a wrong code shows the message and clears the boxes", async () => {
    const verifyCode = jest.fn(() => Promise.reject(new ApiError("OTP_INVALID", 401, "wrong")));
    await render(
      <CodeForm
        email="a@b.co"
        verifyCode={verifyCode}
        requestCode={() => Promise.resolve()}
        onVerified={() => {}}
      />,
    );
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "000000");
    expect(await screen.findByText("That code is not right. Check the email and try again.")).toBeTruthy();
    expect(screen.getByTestId("code-box-0")).toHaveTextContent("");
  });

  it("a locked code offers a new one", async () => {
    const verifyCode = jest.fn(() => Promise.reject(new ApiError("OTP_LOCKED", 401, "locked")));
    const requestCode = jest.fn(() => Promise.resolve());
    await render(
      <CodeForm email="a@b.co" verifyCode={verifyCode} requestCode={requestCode} onVerified={() => {}} />,
    );
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "000000");
    expect(await screen.findByText("Too many tries. Request a new code or try again tomorrow.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Send a new code" }));
    await waitFor(() => expect(requestCode).toHaveBeenCalledWith("a@b.co"));
  });
});
